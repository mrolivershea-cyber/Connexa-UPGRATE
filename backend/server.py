from fastapi import FastAPI, APIRouter, Depends, HTTPException, status, Request, File, UploadFile, Form
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
from starlette.middleware.sessions import SessionMiddleware
from starlette.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from typing import List, Dict, Optional
import os
import re
import json
import csv
import io
import asyncio
import threading
from datetime import datetime, timedelta
from pathlib import Path
import logging

# Local imports
from database import get_db, User, Node, create_tables, hash_password, verify_password, SessionLocal
from auth import (
    create_access_token, authenticate_user, get_current_user, 
    get_current_user_optional, ACCESS_TOKEN_EXPIRE_MINUTES
)
from schemas import (
    UserCreate, NodeCreate, NodeUpdate, LoginRequest, ChangePasswordRequest,
    BulkImport, ImportNodesSchema, ExportRequest, Token, ServiceAction, TestRequest
)
from services import service_manager, network_tester

# Progress Tracking System
import uuid
progress_store = {}

class ProgressTracker:
    def __init__(self, session_id: str, total_items: int):
        self.session_id = session_id
        self.total_items = total_items
        self.processed_items = 0
        self.current_task = ""
        self.status = "running"
        self.results = []
        
    def update(self, processed: int, current_task: str = "", add_result: dict = None):
        self.processed_items = processed
        self.current_task = current_task
        if add_result:
            self.results.append(add_result)
        progress_store[self.session_id] = self
    
    def complete(self, status: str = "completed"):
        self.status = status
        progress_store[self.session_id] = self
    
    def to_dict(self):
        return {
            "session_id": self.session_id,
            "total_items": self.total_items,
            "processed_items": self.processed_items,
            "current_task": self.current_task,
            "status": self.status,
            "progress_percent": int((self.processed_items / self.total_items) * 100) if self.total_items > 0 else 0,
            "results": self.results
        }

async def cleanup_stuck_nodes():
    """Clean up nodes stuck in 'checking' status on startup"""
    try:
        db = next(get_db())
        stuck_nodes = db.query(Node).filter(Node.status == "checking").all()
        if stuck_nodes:
            for node in stuck_nodes:
                node.status = "not_tested"
                node.last_update = datetime.utcnow()
            db.commit()
            logger.info(f"🧹 Cleaned up {len(stuck_nodes)} nodes stuck in 'checking' status on startup")
        else:
            logger.info("✅ No stuck nodes found during startup cleanup")
    except Exception as e:
        logger.error(f"❌ Error during stuck nodes cleanup: {str(e)}")

# Setup
ROOT_DIR = Path(__file__).parent

app = FastAPI(title="Connexa Admin Panel", version="1.7")
api_router = APIRouter(prefix="/api")

# Middleware
app.add_middleware(SessionMiddleware, secret_key=os.getenv("SECRET_KEY", "connexa-secret"))
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.getenv('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create tables on startup
create_tables()

# Create default admin user if not exists
@app.on_event("startup")
async def startup_event():
    db = next(get_db())
    admin_user = db.query(User).filter(User.username == "admin").first()
    if not admin_user:
        admin_user = User(
            username="admin",
            password=hash_password("admin")
        )
        db.add(admin_user)
        db.commit()
        logger.info("Default admin user created with username: admin, password: admin")
    
    # Clean up any nodes stuck in 'checking' status on startup
    await cleanup_stuck_nodes()
    
    # Start background monitoring with improved protection
    start_background_monitoring()
    logger.info("✅ Background monitoring RE-ENABLED with enhanced speed_ok protection")
# Helper to choose ping ports based on node configuration
# B) Keep general TCP ping (no protocol handshake) but use DB-configured ports with fallbacks

def get_ping_ports_for_node(node: Node) -> list[int]:
    try:
        ports = []
        proto = (node.protocol or "").lower()
        # Prefer explicit node.port when present
        if node.port:
            ports.append(int(node.port))
        if proto == "pptp":
            if 1723 not in ports:
                ports.append(1723)
        elif proto == "socks":
            # Prefer stored socks_port, then common default 1080
            if getattr(node, "socks_port", None):
                sp = int(node.socks_port)
                if sp not in ports:
                    ports.append(sp)
            if 1080 not in ports:
                ports.append(1080)
        elif proto == "ovpn":
            # Common OpenVPN TCP ports
            for p in [1194, 443]:
                if p not in ports:
                    ports.append(p)
        elif proto == "ssh":
            if 22 not in ports:
                ports.append(22)
        # Universal TCP fallbacks for reachability
        for p in [443, 80, 22]:
            if p not in ports:
                ports.append(p)
        # Ensure unique and valid
        ports = [int(p) for p in ports if isinstance(p, (int, str))]
        # Limit to reasonable list length
        return ports[:6]
    except Exception:
        # Safe fallback
        return [1723, 443, 80, 22]


# ===== BACKGROUND MONITORING SYSTEM =====
# This system monitors ONLY online nodes every 5 minutes as per user requirements

monitoring_active = False

async def monitor_online_nodes():
    """
    Background monitoring task for online nodes ONLY
    CRITICAL: This function MUST NEVER touch nodes with speed_ok, ping_ok, or any non-online status
    """
    global monitoring_active
    
    while monitoring_active:
        try:
            # Create separate session to avoid transaction conflicts
            db = SessionLocal()
            
            # CRITICAL: Query ONLY nodes with 'online' status
            # This ensures we NEVER touch speed_ok or other statuses
            online_count = db.query(Node).filter(Node.status == "online").count()
            
            if online_count > 0:
                logger.info(f"🔍 Background monitor cycle starting - {online_count} online nodes found")
                
                # Get fresh list of online nodes
                online_nodes = db.query(Node).filter(Node.status == "online").all()
                
                for node in online_nodes:
                    # ABSOLUTE SAFETY: Re-query node to ensure status hasn't changed
                    fresh_node = db.query(Node).filter(Node.id == node.id).first()
                    
                    if not fresh_node:
                        logger.warning(f"⚠️ Monitor: Node {node.id} no longer exists")
                        continue
                    
                    # CRITICAL PROTECTION: If status is NOT online, skip it completely
                    if fresh_node.status != "online":
                        logger.info(f"🛡️ Monitor: Node {node.id} status changed to {fresh_node.status} - SKIPPING (only monitor online nodes)")
                        continue
                    
                    try:
                        # Check if services are still running
                        service_status = await service_manager.get_service_status(node.id)
                        
                        if not service_status.get('active', False):
                            # Double-check status before changing
                            if fresh_node.status == "online":
                                logger.warning(f"❌ Monitor: Node {node.id} services failed - marking offline")
                                fresh_node.status = "offline"
                                fresh_node.last_update = datetime.utcnow()
                            else:
                                logger.warning(f"⚠️ Monitor: Node {node.id} status already {fresh_node.status} - not changing")
                    
                    except Exception as node_error:
                        logger.error(f"❌ Monitor: Error checking node {node.id}: {node_error}")
                        # NEVER change status on monitoring errors
            else:
                logger.debug("🔍 Background monitor cycle - no online nodes to monitor")
            
            # Commit changes for this monitoring cycle
            db.commit()
            db.close()
            logger.debug("✅ Background monitor cycle complete")
            
        except Exception as e:
            logger.error(f"❌ Background monitoring error: {e}")
            try:
                db.rollback()
                db.close()
            except Exception:
                pass
        
        # Wait 5 minutes before next check
        await asyncio.sleep(300)  # 300 seconds = 5 minutes
        
        # Periodic cleanup of stuck nodes (every 5 minutes)
        try:
            await cleanup_stuck_nodes()
        except Exception as cleanup_error:
            logger.error(f"❌ Error during periodic stuck nodes cleanup: {cleanup_error}")

def run_monitoring_loop():
    """Run the monitoring loop in a separate thread"""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(monitor_online_nodes())

def start_background_monitoring():
    """Start the background monitoring service"""
    global monitoring_active
    
    if not monitoring_active:
        monitoring_active = True
        monitoring_thread = threading.Thread(target=run_monitoring_loop, daemon=True)
        monitoring_thread.start()
        logger.info("✅ Background monitoring service started - checking online nodes every 5 minutes")

@app.on_event("shutdown")
async def shutdown_event():
    """Stop monitoring on app shutdown"""
    global monitoring_active
    monitoring_active = False
    logger.info("Background monitoring service stopped")

# Authentication Routes
@api_router.post("/auth/login", response_model=Token)
async def login(login_request: LoginRequest, request: Request, db: Session = Depends(get_db)):
    user = authenticate_user(db, login_request.username, login_request.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password"
        )
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    
    # Also set session for web UI
    request.session["user_id"] = user.id
    request.session["username"] = user.username
    
    return {"access_token": access_token, "token_type": "bearer"}

@api_router.post("/auth/logout")
async def logout(request: Request):
    request.session.clear()
    return {"message": "Logged out successfully"}

@api_router.post("/auth/change-password")
async def change_password(
    change_request: ChangePasswordRequest, 
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not verify_password(change_request.old_password, current_user.password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect old password"
        )
    
    if change_request.new_password != change_request.confirm_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password and confirmation do not match"
        )
    
    current_user.password = hash_password(change_request.new_password)
    db.commit()
    
    return {"message": "Password changed successfully"}

@api_router.get("/auth/me")
async def get_current_user_info(current_user: User = Depends(get_current_user)):
    return {"username": current_user.username, "id": current_user.id}

# Node CRUD Routes
def apply_node_filters(query, **filters):
    """Helper function to apply filters to node queries - reduces code duplication"""
    ip = filters.get('ip')
    provider = filters.get('provider')
    country = filters.get('country')
    state = filters.get('state')
    city = filters.get('city')
    zipcode = filters.get('zipcode')
    login = filters.get('login')
    comment = filters.get('comment')
    status = filters.get('status')
    protocol = filters.get('protocol')
    only_online = filters.get('only_online')
    
    # Apply filters - optimize for exact matches first, then partial
    if ip:
        # Try exact match first, then partial
        if '.' in ip and len(ip) > 7:  # Looks like a full IP
            query = query.filter(Node.ip == ip)
        else:
            query = query.filter(Node.ip.ilike(f"%{ip}%"))
    
    # Exact matches for these fields are faster with indexes
    if provider:
        query = query.filter(Node.provider.ilike(f"%{provider}%"))
    if country:
        query = query.filter(Node.country.ilike(f"%{country}%"))
    if state:
        query = query.filter(Node.state.ilike(f"%{state}%"))
    if city:
        query = query.filter(Node.city.ilike(f"%{city}%"))
    if zipcode:
        # Zipcode is usually exact
        if len(zipcode) >= 4:  # Likely full zipcode
            query = query.filter(Node.zipcode == zipcode)
        else:
            query = query.filter(Node.zipcode.ilike(f"%{zipcode}%"))
    if login:
        query = query.filter(Node.login.ilike(f"%{login}%"))
    if comment:
        query = query.filter(Node.comment.ilike(f"%{comment}%"))
    
    # These use indexes for fast exact match
    if status:
        query = query.filter(Node.status == status)
    if protocol:
        query = query.filter(Node.protocol == protocol)
    if only_online:
        query = query.filter(Node.status == "online")
    
    return query

@api_router.get("/nodes")
async def get_nodes(
    page: int = 1,
    limit: int = 200,
    ip: Optional[str] = None,
    provider: Optional[str] = None,
    country: Optional[str] = None,
    state: Optional[str] = None,
    city: Optional[str] = None,
    zipcode: Optional[str] = None,
    login: Optional[str] = None,
    comment: Optional[str] = None,
    status: Optional[str] = None,
    protocol: Optional[str] = None,
    only_online: Optional[bool] = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Build filters dict
    filters = {k: v for k, v in locals().items() 
              if k not in ['page', 'limit', 'current_user', 'db'] and v is not None}
    
    # Apply filters using helper function
    query = apply_node_filters(db.query(Node), **filters)
    
    # Use a single query for count to improve performance
    total_count = query.count()
    nodes = query.offset((page - 1) * limit).limit(limit).all()
    
    return {
        "nodes": nodes,
        "total": total_count,
        "page": page,
        "limit": limit,
        "total_pages": (total_count + limit - 1) // limit
    }

@api_router.get("/nodes/all-ids")
async def get_all_node_ids(
    ip: Optional[str] = None,
    provider: Optional[str] = None,
    country: Optional[str] = None,
    state: Optional[str] = None,
    city: Optional[str] = None,
    zipcode: Optional[str] = None,
    login: Optional[str] = None,
    comment: Optional[str] = None,
    status: Optional[str] = None,
    protocol: Optional[str] = None,
    only_online: Optional[bool] = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all node IDs that match the filters (for Select All functionality)"""
    # Build filters dict
    filters = {k: v for k, v in locals().items() 
              if k not in ['current_user', 'db'] and v is not None}
    
    # Apply filters using helper function - only select ID for performance
    query = apply_node_filters(db.query(Node.id), **filters)
    
    # Get all IDs (no pagination) - more efficient list comprehension
    node_ids = [row[0] for row in query.all()]
    
    return {
        "node_ids": node_ids,
        "total_count": len(node_ids)
    }

@api_router.get("/nodes/{node_id}")
async def get_node_by_id(
    node_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get a single node by ID"""
    node = db.query(Node).filter(Node.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    
    logger.info(f"🔍 GET /nodes/{node_id} - Returning node with status: {node.status}")
    return node

@api_router.post("/nodes")
async def create_node(
    node: NodeCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    logger.info(f"🔍 Creating node with input status: {node.dict().get('status', 'not specified')}")
    db_node = Node(**node.dict())
    db_node.last_update = datetime.utcnow()  # Set current time on creation
    logger.info(f"🔍 Node object status before add: {db_node.status}")
    db.add(db_node)
    # Remove explicit commit - let get_db() handle it
    db.flush()  # Flush to get the ID
    logger.info(f"🔍 Node object status after flush: {db_node.status}")
    db.refresh(db_node)
    logger.info(f"🔍 Node object status after refresh: {db_node.status}")
    
    # Double-check by querying the database directly
    check_node = db.query(Node).filter(Node.id == db_node.id).first()
    logger.info(f"🔍 Node status from direct DB query: {check_node.status if check_node else 'not found'}")
    logger.info(f"✅ Returning created node with status: {db_node.status}")
    
    return db_node

@api_router.put("/nodes/{node_id}")
async def update_node(
    node_id: int,
    node_update: NodeUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    db_node = db.query(Node).filter(Node.id == node_id).first()
    if not db_node:
        raise HTTPException(status_code=404, detail="Node not found")
    
    update_data = node_update.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_node, field, value)
    
    db.commit()
    db.refresh(db_node)
    return db_node

@api_router.delete("/nodes/{node_id}")
async def delete_node(
    node_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    db_node = db.query(Node).filter(Node.id == node_id).first()
    if not db_node:
        raise HTTPException(status_code=404, detail="Node not found")
    
    db.delete(db_node)
    db.commit()
    return {"message": "Node deleted successfully"}

@api_router.delete("/nodes")
async def delete_multiple_nodes(
    request: dict,  # Accept JSON body
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    node_ids = request.get("node_ids", [])
    if not node_ids:
        raise HTTPException(status_code=400, detail="No node IDs provided")
    
    deleted_count = db.query(Node).filter(Node.id.in_(node_ids)).delete(synchronize_session=False)
    db.commit()
    return {"message": f"Deleted {deleted_count} nodes successfully"}

@api_router.post("/nodes/import")
async def import_nodes(
    data: ImportNodesSchema,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Enhanced import with comprehensive parsing and deduplication"""
    
    # Generate session ID for progress tracking
    session_id = str(uuid.uuid4())
    
    try:
        logger.info(f"Import request with testing_mode: {data.testing_mode}, session_id: {session_id}")
        
        # Parse text data with enhanced parser
        parsed_data = parse_nodes_text(data.data, data.protocol)
        
        # Process nodes with deduplication logic
        results = process_parsed_nodes(db, parsed_data, data.testing_mode)
        
        # Perform testing if requested  
        if data.testing_mode != "no_test" and (results['added'] or results['replaced']):
            # Get node IDs to test
            nodes_to_test = []
            for added_node in results['added']:
                nodes_to_test.append(added_node['id'])
            for replaced_node in results['replaced']:
                nodes_to_test.append(replaced_node['id'])
            
            if nodes_to_test:
                # Initialize progress tracker
                progress = ProgressTracker(session_id, len(nodes_to_test))
                progress.update(0, f"Начинаем тестирование {len(nodes_to_test)} серверов...")
                
                logger.info(f"📊 Import: Starting batch testing for session {session_id} with {len(nodes_to_test)} nodes")
                
                # Start background batch testing instead of blocking
                asyncio.create_task(process_import_testing_batches(
                    session_id, nodes_to_test, data.testing_mode, db
                ))
                # Testing will be handled asynchronously by batch processor
                logger.info(f"📊 Import: Queued {len(nodes_to_test)} nodes for batch testing in session {session_id}")
        
        # Create detailed report with smart summary
        added_count = len(results['added'])
        skipped_count = len(results['skipped'])
        replaced_count = len(results['replaced'])
        queued_count = len(results['queued'])
        format_errors_count = len(results['format_errors'])
        processing_errors_count = len(results['errors'])
        
        # Generate smart message based on results
        if added_count == 0 and skipped_count > 0:
            # All duplicates - nothing new added
            if skipped_count == parsed_data['successfully_parsed']:
                smart_message = f"Ничего не добавлено: все {skipped_count} конфигураций уже существуют в базе данных. Дубликаты не добавляются автоматически."
            else:
                smart_message = f"Импорт завершён: {added_count} добавлено, {skipped_count} пропущено (уже в базе)"
        elif added_count > 0 and skipped_count > 0:
            # Mixed: some new, some duplicates
            smart_message = f"Импорт завершён: {added_count} новых конфигураций добавлено, {skipped_count} дубликатов пропущено"
            if replaced_count > 0:
                smart_message += f", {replaced_count} старых заменено"
        elif added_count > 0 and skipped_count == 0:
            # All new
            smart_message = f"Успешно добавлено {added_count} новых конфигураций"
        else:
            # Nothing processed successfully
            smart_message = f"Импорт не выполнен: {format_errors_count} ошибок формата"
        
        # Add additional info if needed
        if queued_count > 0:
            smart_message += f", {queued_count} отправлено на проверку"
        if format_errors_count > 0:
            smart_message += f", {format_errors_count} ошибок формата"
        
        report = {
            "total_processed": parsed_data['total_processed'],
            "successfully_parsed": parsed_data['successfully_parsed'],
            "added": added_count,
            "skipped_duplicates": skipped_count,
            "replaced_old": replaced_count,
            "queued_for_verification": queued_count,
            "format_errors": format_errors_count,
            "processing_errors": processing_errors_count,
            "testing_mode": data.testing_mode,
            "smart_summary": smart_message,
            "details": results
        }
        
        return {
            "success": True,
            "message": smart_message,
            "report": report,
            "session_id": session_id if data.testing_mode != "no_test" else None
        }
        
    except Exception as e:
        logger.error(f"Import error: {str(e)}", exc_info=True)
        
        # Mark progress as failed if exists
        if session_id in progress_store:
            progress_store[session_id].complete("failed")
        
        return {
            "success": False, 
            "message": f"Import failed: {str(e)}",
            "report": {
                "total_processed": 0,
                "successfully_parsed": 0,
                "added": 0,
                "skipped_duplicates": 0,
                "replaced_old": 0,
                "queued_for_verification": 0,
                "format_errors": 0,
                "processing_errors": 1,
                "testing_mode": data.testing_mode,
                "details": {"errors": [{"general": str(e)}]}
            },
            "session_id": session_id
        }

async def process_import_testing_batches(session_id: str, node_ids: list, testing_mode: str, db_session: Session):
    """Process node testing in batches to prevent hanging and preserve results"""
    
    # Just delegate to the unified testing batches function
    await process_testing_batches(session_id, node_ids, testing_mode, db_session)

# Import/Export Routes
@api_router.post("/import")
async def import_nodes_legacy(
    data: BulkImport,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Parse and import nodes from text data"""
    parsed_result = parse_nodes_text(data.data, data.protocol)
    
    # Handle both old and new format returns
    if isinstance(parsed_result, dict) and 'nodes' in parsed_result:
        nodes_data = parsed_result['nodes']
    else:
        nodes_data = parsed_result
    
    created_nodes = []
    errors = []
    duplicates = 0
    
    for node_data in nodes_data:
        try:
            # Check for duplicates
            existing = db.query(Node).filter(
                and_(Node.ip == node_data['ip'], Node.login == node_data.get('login', ''))
            ).first()
            
            if existing:
                duplicates += 1
                continue
            
            node = Node(**node_data)
            db.add(node)
            created_nodes.append(node_data)
        except Exception as e:
            errors.append(f"Error processing {node_data.get('ip', 'unknown')}: {str(e)}")
    
    db.commit()
    
    return {
        "created": len(created_nodes),
        "duplicates": duplicates,
        "errors": errors,
        "total_processed": len(nodes_data) if isinstance(nodes_data, list) else parsed_result.get('total_processed', 0)
    }

@api_router.post("/export")
async def export_nodes(
    export_request: ExportRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Export selected nodes"""
    nodes = db.query(Node).filter(Node.id.in_(export_request.node_ids)).all()
    
    if export_request.format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["IP", "Login", "Password", "Protocol", "Provider", "Country", "State", "City", "ZIP", "Comment"])
        
        for node in nodes:
            writer.writerow([
                node.ip, node.login, node.password, node.protocol,
                node.provider, node.country, node.state, node.city,
                node.zipcode, node.comment
            ])
        
        return JSONResponse(
            content={"data": output.getvalue(), "filename": f"connexa_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"}
        )
    
    else:  # txt format (default)
        lines = []
        for node in nodes:
            if export_request.format == "socks":
                lines.append(f"{node.ip}:1080:{node.login}:{node.password}")
            else:
                lines.append(f"{node.ip} {node.login} {node.password} {node.country or 'N/A'}")
        
        return JSONResponse(
            content={"data": "\n".join(lines), "filename": f"connexa_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"}
        )

def clean_text_data(text: str) -> str:
    """Clean and normalize text data - remove headers, mentions, comments"""
    lines = []
    for line in text.split('\n'):
        line = line.strip()
        
        # Skip empty lines
        if not line:
            continue
        
        # Skip comment lines (starting with # or //)
        if line.startswith('#') or line.startswith('//'):
            continue
        
        # Skip Telegram channel mentions (lines starting with @)
        if line.startswith('@'):
            continue
        
        # Skip channel/group names (short lines with only letters/spaces, no colons or IPs)
        # Examples: "StealUrVPN", "GVBot", "Worldwide VPN Hub", "PPTP INFINITY"
        if len(line) < 50 and ':' not in line and not any(char.isdigit() for char in line):
            # Check if it looks like a header (mostly uppercase or title case)
            if line.isupper() or line.istitle() or all(c.isalpha() or c.isspace() for c in line):
                continue
        
        # Remove inline comments (text after # or // in single-line formats)
        if '  #' in line:
            line = line.split('  #')[0].strip()
        elif '  //' in line:
            line = line.split('  //')[0].strip()
        
        # Remove multiple spaces, tabs, and normalize
        cleaned_line = ' '.join(line.split())
        
        if cleaned_line:
            lines.append(cleaned_line)
    
    return '\n'.join(lines)

def detect_format(block: str) -> str:
    """Detect which format the block matches"""
    lines = block.split('\n')
    
    # Format 6: Multi-line with PPTP header (ignore first 2 lines) - Check first
    if len(lines) >= 6 and ('PPTP_SVOIM_VPN' in lines[0] or 'PPTP Connection' in lines[1]):
        return "format_6"
    
    # Format 5: Multi-line with IP:, Credentials:, Location:, ZIP: - Check before Format 1
    if len(lines) >= 4 and any('IP:' in line for line in lines) and any('Credentials:' in line for line in lines):
        return "format_5"
    
    # Format 1: Key-value with colons (Ip: xxx, Login: xxx, Pass: xxx) - More specific check
    if any(line.strip().startswith(('Ip:', 'Login:', 'Pass:')) for line in lines):
        return "format_1"
    
    # Single line formats
    single_line = block.strip()
    
    # Format 3: With - and | separators
    if ' - ' in single_line and (' | ' in single_line or re.search(r'\d{4}-\d{2}-\d{2}', single_line)):
        return "format_3"
    
    # Format 4: Colon separated (5+ colons)
    if single_line.count(':') >= 4:
        return "format_4"
    
    # Format 2: Single line with spaces (IP Login Password State)
    parts = single_line.split()
    if len(parts) >= 4 and is_valid_ip(parts[0]):
        return "format_2"
    
    return "unknown"

def parse_nodes_text(text: str, protocol: str = "pptp") -> dict:
    """Enhanced parser with TWO-PASS smart block splitting algorithm"""
    # Clean input text (removes headers, @mentions, comments)
    text = clean_text_data(text)
    
    parsed_nodes = []
    duplicates = []
    format_errors = []
    blocks = []
    
    # PASS 1: Split by explicit separator '---------------------' first
    if '---------------------' in text:
        pre_blocks = text.split('---------------------')
    else:
        pre_blocks = [text]
    
    # PASS 2: Process each pre_block with TWO-PASS algorithm
    for pre_block in pre_blocks:
        pre_block = pre_block.strip()
        if not pre_block:
            continue
        
        # SUB-PASS 1: Extract all single-line formats first (Format 2, 3, 4)
        lines = pre_block.split('\n')
        single_line_blocks = []
        remaining_lines = []
        
        for line in lines:
            line = line.strip()
            if not line:
                continue
            
            is_single_line = False
            
            # Check Format 4: Colon-separated (at least 5 colons, starts with IP)
            parts_colon = line.split(':')
            if len(parts_colon) >= 6 and is_valid_ip(parts_colon[0].strip()):
                single_line_blocks.append(line)
                is_single_line = True
            
            # Check Format 3: Dash format (IP - login:pass - State/City)
            elif ' - ' in line:
                parts_space = line.split()
                if parts_space and is_valid_ip(parts_space[0]):
                    single_line_blocks.append(line)
                    is_single_line = True
            
            # Check Format 2: Space-separated (IP Login Password State)
            elif not is_single_line:
                parts_space = line.split()
                if len(parts_space) >= 3 and is_valid_ip(parts_space[0]):
                    # Make sure it's not a line like "IP: xxx" (Format 1/5/6)
                    if ':' not in line or line.count(':') < 2:
                        single_line_blocks.append(line)
                        is_single_line = True
            
            # If not a single-line format, add to remaining for multi-line processing
            if not is_single_line:
                remaining_lines.append(line)
        
        # Add all extracted single-line blocks
        blocks.extend(single_line_blocks)
        
        # SUB-PASS 2: Process remaining lines for multi-line formats (Format 1, 5, 6)
        if remaining_lines:
            remaining_text = '\n'.join(remaining_lines)
            
            # Check for multiple Format 1 entries (multiple "Ip:")
            if remaining_text.count('Ip:') > 1 or remaining_text.count('IP:') > 1:
                # Split by "Ip:" to separate multiple configs
                entries = re.split(r'(?=\bIp:|\bIP:)', remaining_text, flags=re.IGNORECASE)
                for entry in entries:
                    entry = entry.strip()
                    if entry and ('Ip:' in entry or 'IP:' in entry):
                        blocks.append(entry)
            
            # Check for multiple Format 6 entries (PPTP header)
            elif remaining_text.count('> PPTP_SVOIM_VPN:') > 1:
                entries = re.split(r'(?=> PPTP_SVOIM_VPN:)', remaining_text)
                for entry in entries:
                    entry = entry.strip()
                    if entry:
                        blocks.append(entry)
            
            # Single multi-line block
            elif remaining_text.strip():
                blocks.append(remaining_text.strip())
    
    # PASS 3: Parse each block
    for block_index, block in enumerate(blocks):
        block = block.strip()
        if not block or len(block) < 5:
            continue
        
        try:
            format_type = detect_format(block)
            node_data = {"protocol": protocol}  # Don't set status - let Node model default to "not_tested"
            
            if format_type == "format_1":
                node_data = parse_format_1(block, node_data)
            elif format_type == "format_2":
                node_data = parse_format_2(block, node_data)
            elif format_type == "format_3":
                node_data = parse_format_3(block, node_data)
            elif format_type == "format_4":
                node_data = parse_format_4(block, node_data)
            elif format_type == "format_5":
                node_data = parse_format_5(block, node_data)
            elif format_type == "format_6":
                node_data = parse_format_6(block, node_data)
            else:
                # Try regex-based smart parsing as fallback
                node_data = parse_with_smart_regex(block, node_data)
                if not node_data.get('ip'):
                    format_errors.append(f"Block {block_index + 1}: {block[:100]}")
                    continue
            
            # Validate required fields
            if not node_data.get('ip') or not is_valid_ip(node_data['ip']):
                format_errors.append(f"Invalid IP in block {block_index + 1}: {block[:100]}")
                continue
                
            if not node_data.get('login') or not node_data.get('password'):
                format_errors.append(f"Missing credentials in block {block_index + 1}: {block[:100]}")
                continue
            
            # Normalize data
            if node_data.get('state'):
                node_data['state'] = normalize_state_country(node_data['state'], node_data.get('country', ''))
            if node_data.get('country'):
                node_data['country'] = normalize_country_code(node_data['country'])
            
            parsed_nodes.append(node_data)
            
        except Exception as e:
            format_errors.append(f"Parse error in block {block_index + 1}: {str(e)} - {block[:100]}")
            continue
    
    return {
        'nodes': parsed_nodes,
        'duplicates': duplicates,
        'format_errors': format_errors,
        'total_processed': len(blocks),
        'successfully_parsed': len(parsed_nodes)
    }

def parse_format_1(block: str, node_data: dict) -> dict:
    """Format 1: Ip: xxx, Login: xxx, Pass: xxx, State: xxx, City: xxx, Zip: xxx"""
    lines = block.split('\n')
    for line in lines:
        if ':' not in line:
            continue
        
        # Split only on first colon to handle values with colons
        parts = line.split(':', 1)
        if len(parts) < 2:
            continue
            
        key = parts[0].strip().lower()
        value = parts[1].strip()
        
        # Remove extra text after IP (e.g., "71.84.237.32 a_reg_107" -> "71.84.237.32")
        if key in ['ip', 'host']:
            # Extract only the IP part (first word if multiple words)
            ip_match = re.match(r'(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})', value)
            if ip_match:
                node_data['ip'] = ip_match.group(1)
            else:
                # Just take first word
                node_data['ip'] = value.split()[0] if value else value
        elif key == 'login':
            node_data['login'] = value
        elif key in ['pass', 'password']:
            node_data['password'] = value
        elif key == 'state':
            node_data['state'] = value
        elif key == 'city':
            node_data['city'] = value
        elif key in ['zip', 'zipcode']:
            node_data['zipcode'] = value
        elif key == 'country':
            node_data['country'] = value
        elif key == 'provider':
            node_data['provider'] = value
    
    return node_data

def parse_with_smart_regex(block: str, node_data: dict) -> dict:
    """Smart regex-based parser as fallback when format detection fails"""
    # Try to extract IP address
    ip_pattern = r'\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b'
    ip_match = re.search(ip_pattern, block)
    if ip_match:
        node_data['ip'] = ip_match.group(1)
    
    # Try to extract login and password
    # Pattern 1: "Login: xxx" and "Pass: xxx"
    login_match = re.search(r'(?:Login|login|USERNAME|username):\s*(\S+)', block)
    if login_match:
        node_data['login'] = login_match.group(1)
    
    pass_match = re.search(r'(?:Pass|pass|Password|password|PASS):\s*(\S+)', block)
    if pass_match:
        node_data['password'] = pass_match.group(1)
    
    # Pattern 2: "Credentials: login:password"
    cred_match = re.search(r'Credentials:\s*(\S+):(\S+)', block)
    if cred_match:
        node_data['login'] = cred_match.group(1)
        node_data['password'] = cred_match.group(2)
    
    # Pattern 3: Space-separated "IP login password state"
    if not node_data.get('login') and node_data.get('ip'):
        # Try to find login/pass after IP
        parts = block.split()
        for i, part in enumerate(parts):
            if part == node_data['ip'] and i + 2 < len(parts):
                node_data['login'] = parts[i + 1]
                node_data['password'] = parts[i + 2]
                if i + 3 < len(parts):
                    node_data['state'] = parts[i + 3]
                break
    
    # Try to extract state
    state_match = re.search(r'(?:State|state|STATE):\s*(\S+)', block)
    if state_match:
        node_data['state'] = state_match.group(1)
    
    # Try to extract city
    city_match = re.search(r'(?:City|city|CITY):\s*([^\n]+)', block)
    if city_match:
        node_data['city'] = city_match.group(1).strip()
    
    # Try to extract ZIP
    zip_match = re.search(r'(?:Zip|ZIP|zipcode|Zipcode):\s*(\d{5})', block)
    if zip_match:
        node_data['zipcode'] = zip_match.group(1)
    
    # Try to extract Location: "State (City)"
    location_match = re.search(r'Location:\s*([^(]+)\(([^)]+)\)', block)
    if location_match:
        node_data['state'] = location_match.group(1).strip()
        node_data['city'] = location_match.group(2).strip()
    
    return node_data

def parse_format_2(block: str, node_data: dict) -> dict:
    """Format 2: IP Login Password State (single line with spaces)"""
    parts = block.split()
    if len(parts) >= 4:
        node_data['ip'] = parts[0]
        node_data['login'] = parts[1]  # Correct order: IP Login Password State
        node_data['password'] = parts[2]
        node_data['state'] = parts[3]
    return node_data

def parse_format_3(block: str, node_data: dict) -> dict:
    """Format 3: IP - Login:Pass - State/City Zip | Last Update"""
    # Remove timestamp part
    main_part = block.split(' | ')[0] if ' | ' in block else block
    parts = main_part.split(' - ')
    
    if len(parts) >= 3:
        node_data['ip'] = parts[0].strip()
        
        # Parse credentials
        creds = parts[1].strip()
        if ':' in creds:
            login, password = creds.split(':', 1)
            node_data['login'] = login.strip()
            node_data['password'] = password.strip()
        
        # Parse location
        location = parts[2].strip()
        if '/' in location:
            state_part, city_part = location.split('/', 1)
            node_data['state'] = state_part.strip()
            
            # Extract city (before ZIP)
            city_and_zip = city_part.strip().split()
            if city_and_zip:
                node_data['city'] = city_and_zip[0]
                # Look for ZIP in remaining parts
                for part in city_and_zip[1:]:
                    if re.match(r'^\d{5}(-\d{4})?$', part):
                        node_data['zipcode'] = part
                        break
    return node_data

def parse_format_4(block: str, node_data: dict) -> dict:
    """Format 4: IP:Login:Pass:Country:State:Zip"""
    parts = block.split(':')
    if len(parts) >= 6:
        node_data['ip'] = parts[0].strip()
        node_data['login'] = parts[1].strip()
        node_data['password'] = parts[2].strip()
        node_data['country'] = parts[3].strip()
        node_data['state'] = parts[4].strip()
        node_data['zipcode'] = parts[5].strip()
    return node_data

def parse_format_5(block: str, node_data: dict) -> dict:
    """Format 5: Multi-line with IP:, Credentials:, Location:, ZIP:"""
    lines = block.split('\n')
    for line in lines:
        line = line.strip()
        if line.startswith("IP:"):
            node_data['ip'] = line.split(':', 1)[1].strip()
        elif line.startswith("Credentials:"):
            creds = line.split(':', 1)[1].strip()
            if ':' in creds:
                login, password = creds.split(':', 1)
                node_data['login'] = login.strip()
                node_data['password'] = password.strip()
        elif line.startswith("Location:"):
            location = line.split(':', 1)[1].strip()
            # Parse "State (City)" format
            if '(' in location and ')' in location:
                state = location.split('(')[0].strip()
                city = location.split('(')[1].split(')')[0].strip()
                node_data['state'] = state
                node_data['city'] = city
        elif line.startswith("ZIP:"):
            node_data['zipcode'] = line.split(':', 1)[1].strip()
    return node_data

def parse_format_6(block: str, node_data: dict) -> dict:
    """Format 6: Multi-line with first 2 lines ignored"""
    lines = block.split('\n')
    # Skip first 2 lines
    relevant_lines = lines[2:] if len(lines) > 2 else lines
    
    for line in relevant_lines:
        line = line.strip()
        if line.startswith("IP:"):
            node_data['ip'] = line.split(':', 1)[1].strip()
        elif line.startswith("Credentials:"):
            creds = line.split(':', 1)[1].strip()
            if ':' in creds:
                login, password = creds.split(':', 1)
                node_data['login'] = login.strip()
                node_data['password'] = password.strip()
        elif line.startswith("Location:"):
            location = line.split(':', 1)[1].strip()
            # Parse "State (City)" format
            if '(' in location and ')' in location:
                state = location.split('(')[0].strip()
                city = location.split('(')[1].split(')')[0].strip()
                node_data['state'] = state
                node_data['city'] = city
        elif line.startswith("ZIP:"):
            node_data['zipcode'] = line.split(':', 1)[1].strip()
    return node_data

def normalize_state_country(state_code: str, country: str = "") -> str:
    """Convert state codes to full names for multiple countries"""
    
    # USA States
    usa_states = {
        "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
        "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia",
        "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
        "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
        "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri",
        "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey",
        "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio",
        "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
        "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont",
        "VA": "Virginia", "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
        "DC": "District of Columbia"
    }
    
    # Canada Provinces
    canada_provinces = {
        "AB": "Alberta", "BC": "British Columbia", "MB": "Manitoba", "NB": "New Brunswick",
        "NL": "Newfoundland and Labrador", "NS": "Nova Scotia", "ON": "Ontario", "PE": "Prince Edward Island",
        "QC": "Quebec", "SK": "Saskatchewan", "NT": "Northwest Territories", "NU": "Nunavut", "YT": "Yukon"
    }
    
    # Australia States
    australia_states = {
        "ACT": "Australian Capital Territory", "NSW": "New South Wales", "NT": "Northern Territory",
        "QLD": "Queensland", "SA": "South Australia", "TAS": "Tasmania", "VIC": "Victoria", "WA": "Western Australia"
    }
    
    # Germany States (Länder)
    germany_states = {
        "BW": "Baden-Württemberg", "BY": "Bavaria", "BE": "Berlin", "BB": "Brandenburg", "HB": "Bremen",
        "HH": "Hamburg", "HE": "Hesse", "MV": "Mecklenburg-Vorpommern", "NI": "Lower Saxony",
        "NW": "North Rhine-Westphalia", "RP": "Rhineland-Palatinate", "SL": "Saarland", "SN": "Saxony",
        "ST": "Saxony-Anhalt", "SH": "Schleswig-Holstein", "TH": "Thuringia"
    }
    
    # UK Counties/Regions
    uk_regions = {
        "ENG": "England", "SCT": "Scotland", "WLS": "Wales", "NIR": "Northern Ireland",
        "LON": "London", "MAN": "Manchester", "BIR": "Birmingham", "LIV": "Liverpool"
    }
    
    # France Regions
    france_regions = {
        "ARA": "Auvergne-Rhône-Alpes", "BFC": "Bourgogne-Franche-Comté", "BRE": "Brittany",
        "CVL": "Centre-Val de Loire", "COR": "Corsica", "GES": "Grand Est", "HDF": "Hauts-de-France",
        "IDF": "Île-de-France", "NOR": "Normandy", "NAQ": "Nouvelle-Aquitaine", "OCC": "Occitanie",
        "PDL": "Pays de la Loire", "PAC": "Provence-Alpes-Côte d'Azur"
    }
    
    # Italy Regions
    italy_regions = {
        "ABR": "Abruzzo", "BAS": "Basilicata", "CAL": "Calabria", "CAM": "Campania", "EMR": "Emilia-Romagna",
        "FVG": "Friuli-Venezia Giulia", "LAZ": "Lazio", "LIG": "Liguria", "LOM": "Lombardy", "MAR": "Marche",
        "MOL": "Molise", "PIE": "Piedmont", "PUG": "Puglia", "SAR": "Sardinia", "SIC": "Sicily",
        "TOS": "Tuscany", "TAA": "Trentino-Alto Adige", "UMB": "Umbria", "VDA": "Valle d'Aosta", "VEN": "Veneto"
    }
    
    # Brazil States
    brazil_states = {
        "AC": "Acre", "AL": "Alagoas", "AP": "Amapá", "AM": "Amazonas", "BA": "Bahia", "CE": "Ceará",
        "DF": "Distrito Federal", "ES": "Espírito Santo", "GO": "Goiás", "MA": "Maranhão", "MT": "Mato Grosso",
        "MS": "Mato Grosso do Sul", "MG": "Minas Gerais", "PA": "Pará", "PB": "Paraíba", "PR": "Paraná",
        "PE": "Pernambuco", "PI": "Piauí", "RJ": "Rio de Janeiro", "RN": "Rio Grande do Norte",
        "RS": "Rio Grande do Sul", "RO": "Rondônia", "RR": "Roraima", "SC": "Santa Catarina",
        "SP": "São Paulo", "SE": "Sergipe", "TO": "Tocantins"
    }
    
    # India States
    india_states = {
        "AP": "Andhra Pradesh", "AR": "Arunachal Pradesh", "AS": "Assam", "BR": "Bihar", "CT": "Chhattisgarh",
        "GA": "Goa", "GJ": "Gujarat", "HR": "Haryana", "HP": "Himachal Pradesh", "JK": "Jammu and Kashmir",
        "JH": "Jharkhand", "KA": "Karnataka", "KL": "Kerala", "MP": "Madhya Pradesh", "MH": "Maharashtra",
        "MN": "Manipur", "ML": "Meghalaya", "MZ": "Mizoram", "NL": "Nagaland", "OR": "Odisha",
        "PB": "Punjab", "RJ": "Rajasthan", "SK": "Sikkim", "TN": "Tamil Nadu", "TG": "Telangana",
        "TR": "Tripura", "UP": "Uttar Pradesh", "UT": "Uttarakhand", "WB": "West Bengal"
    }
    
    state_upper = state_code.upper().strip()
    
    # Determine which database to use based on country
    country_lower = country.lower().strip()
    
    if country_lower in ['us', 'usa', 'united states', 'america'] or not country:
        return usa_states.get(state_upper, state_code)
    elif country_lower in ['ca', 'canada']:
        return canada_provinces.get(state_upper, state_code)
    elif country_lower in ['au', 'australia']:
        return australia_states.get(state_upper, state_code)
    elif country_lower in ['de', 'germany', 'deutschland']:
        return germany_states.get(state_upper, state_code)
    elif country_lower in ['uk', 'gb', 'great britain', 'united kingdom']:
        return uk_regions.get(state_upper, state_code)
    elif country_lower in ['fr', 'france']:
        return france_regions.get(state_upper, state_code)
    elif country_lower in ['it', 'italy', 'italia']:
        return italy_regions.get(state_upper, state_code)
    elif country_lower in ['br', 'brazil', 'brasil']:
        return brazil_states.get(state_upper, state_code)
    elif country_lower in ['in', 'india']:
        return india_states.get(state_upper, state_code)
    
    # Default fallback: try USA first, then return original
    return usa_states.get(state_upper, state_code)

def normalize_country_code(code: str) -> str:
    """Convert country codes to full names - comprehensive list"""
    countries = {
        # Major countries
        "US": "United States", "USA": "United States", "AMERICA": "United States",
        "GB": "Great Britain", "UK": "United Kingdom", "BRITAIN": "Great Britain",
        "CA": "Canada", "CANADA": "Canada",
        "AU": "Australia", "AUSTRALIA": "Australia",
        "DE": "Germany", "GERMANY": "Germany", "DEUTSCHLAND": "Germany",
        "FR": "France", "FRANCE": "France",
        "IT": "Italy", "ITALY": "Italy", "ITALIA": "Italy",
        "ES": "Spain", "SPAIN": "Spain", "ESPANA": "Spain",
        "NL": "Netherlands", "NETHERLANDS": "Netherlands", "HOLLAND": "Netherlands",
        "BE": "Belgium", "BELGIUM": "Belgium",
        "CH": "Switzerland", "SWITZERLAND": "Switzerland",
        "AT": "Austria", "AUSTRIA": "Austria",
        "SE": "Sweden", "SWEDEN": "Sweden",
        "NO": "Norway", "NORWAY": "Norway",
        "DK": "Denmark", "DENMARK": "Denmark",
        "FI": "Finland", "FINLAND": "Finland",
        "IE": "Ireland", "IRELAND": "Ireland",
        "PT": "Portugal", "PORTUGAL": "Portugal",
        "GR": "Greece", "GREECE": "Greece",
        "PL": "Poland", "POLAND": "Poland",
        "CZ": "Czech Republic", "CZECH": "Czech Republic",
        "HU": "Hungary", "HUNGARY": "Hungary",
        "RO": "Romania", "ROMANIA": "Romania",
        "BG": "Bulgaria", "BULGARIA": "Bulgaria",
        "HR": "Croatia", "CROATIA": "Croatia",
        "SI": "Slovenia", "SLOVENIA": "Slovenia",
        "SK": "Slovakia", "SLOVAKIA": "Slovakia",
        "LT": "Lithuania", "LITHUANIA": "Lithuania",
        "LV": "Latvia", "LATVIA": "Latvia",
        "EE": "Estonia", "ESTONIA": "Estonia",
        
        # Asian countries
        "JP": "Japan", "JAPAN": "Japan",
        "CN": "China", "CHINA": "China",
        "IN": "India", "INDIA": "India",
        "KR": "South Korea", "KOREA": "South Korea", "SOUTH KOREA": "South Korea",
        "TH": "Thailand", "THAILAND": "Thailand",
        "VN": "Vietnam", "VIETNAM": "Vietnam",
        "SG": "Singapore", "SINGAPORE": "Singapore",
        "MY": "Malaysia", "MALAYSIA": "Malaysia",
        "ID": "Indonesia", "INDONESIA": "Indonesia",
        "PH": "Philippines", "PHILIPPINES": "Philippines",
        "TW": "Taiwan", "TAIWAN": "Taiwan",
        "HK": "Hong Kong", "HONG KONG": "Hong Kong",
        
        # American countries
        "BR": "Brazil", "BRAZIL": "Brazil", "BRASIL": "Brazil",
        "MX": "Mexico", "MEXICO": "Mexico",
        "AR": "Argentina", "ARGENTINA": "Argentina",
        "CL": "Chile", "CHILE": "Chile",
        "CO": "Colombia", "COLOMBIA": "Colombia",
        "PE": "Peru", "PERU": "Peru",
        "VE": "Venezuela", "VENEZUELA": "Venezuela",
        
        # Middle East & Africa
        "IL": "Israel", "ISRAEL": "Israel",
        "TR": "Turkey", "TURKEY": "Turkey",
        "SA": "Saudi Arabia", "SAUDI ARABIA": "Saudi Arabia",
        "AE": "United Arab Emirates", "UAE": "United Arab Emirates",
        "EG": "Egypt", "EGYPT": "Egypt",
        "ZA": "South Africa", "SOUTH AFRICA": "South Africa",
        
        # Oceania
        "NZ": "New Zealand", "NEW ZEALAND": "New Zealand",
        
        # Others
        "RU": "Russia", "RUSSIA": "Russia",
        "UA": "Ukraine", "UKRAINE": "Ukraine",
        "BY": "Belarus", "BELARUS": "Belarus"
    }
    
    return countries.get(code.upper().strip(), code)

def write_format_errors(errors: list[str]) -> str:
    """Write format errors to file"""
    error_file_path = "/app/Format_error.txt"
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    error_content = f"\n\n=== Format Errors - {timestamp} ===\n"
    for i, error in enumerate(errors, 1):
        error_content += f"{i}. {error}\n"
    
    # Append to file
    try:
        with open(error_file_path, "a", encoding="utf-8") as f:
            f.write(error_content)
        return error_file_path
    except Exception as e:
        print(f"Error writing to format error file: {e}")
        return ""

def check_node_duplicate(db: Session, ip: str, login: str, password: str) -> dict:
    """Check for duplicates and handle according to business rules"""
    # Find nodes with same IP
    ip_matches = db.query(Node).filter(Node.ip == ip).all()
    
    if not ip_matches:
        return {"action": "add", "reason": "new_node"}
    
    # Check for exact match (IP + Login + Pass)
    exact_match = db.query(Node).filter(
        Node.ip == ip,
        Node.login == login,
        Node.password == password
    ).first()
    
    if exact_match:
        return {"action": "skip", "reason": "duplicate", "existing_node": exact_match.id}
    
    # Check for IP match with different credentials
    different_creds = [node for node in ip_matches if node.login != login or node.password != password]
    
    if different_creds:
        # Check last update time (4 weeks = 28 days)
        four_weeks_ago = datetime.now() - timedelta(days=28)
        
        old_nodes = [node for node in different_creds if node.last_update < four_weeks_ago]
        recent_nodes = [node for node in different_creds if node.last_update >= four_weeks_ago]
        
        if old_nodes and not recent_nodes:
            # Delete old nodes and add new one
            for old_node in old_nodes:
                db.delete(old_node)
            return {"action": "replace", "reason": "replaced_old", "deleted_nodes": [n.id for n in old_nodes]}
        
        elif recent_nodes:
            # Send to verification queue
            return {"action": "queue", "reason": "verification_needed", "conflicting_nodes": [n.id for n in recent_nodes]}
    
    return {"action": "add", "reason": "unique_credentials"}

def create_verification_queue_entry(db: Session, node_data: dict, conflicting_nodes: list[int]) -> int:
    """Create entry in verification queue"""
    # For now, store in a simple JSON file. Can be upgraded to database table later
    queue_file = "/app/verification_queue.json"
    
    entry = {
        "id": int(datetime.now().timestamp()),
        "timestamp": datetime.now().isoformat(),
        "node_data": node_data,
        "conflicting_node_ids": conflicting_nodes,
        "status": "pending"
    }
    
    try:
        # Load existing queue
        queue_data = []
        if os.path.exists(queue_file):
            with open(queue_file, "r", encoding="utf-8") as f:
                queue_data = json.load(f)
        
        # Add new entry
        queue_data.append(entry)
        
        # Save updated queue
        with open(queue_file, "w", encoding="utf-8") as f:
            json.dump(queue_data, f, indent=2)
        
        return entry["id"]
    except Exception as e:
        print(f"Error creating verification queue entry: {e}")
        return 0

def process_parsed_nodes(db: Session, parsed_data: dict, testing_mode: str = "no_test") -> dict:
    """Process parsed nodes with IN-IMPORT and DB deduplication logic"""
    results = {
        "added": [],
        "skipped": [],
        "replaced": [],
        "queued": [],
        "errors": [],
        "format_errors": parsed_data['format_errors']
    }
    
    # STEP 1: Deduplicate WITHIN the import batch (before checking DB)
    seen_in_import = set()  # Track (ip, login, password) tuples in this import
    unique_nodes = []
    
    for node_data in parsed_data['nodes']:
        node_key = (node_data['ip'], node_data.get('login', ''), node_data.get('password', ''))
        
        if node_key in seen_in_import:
            # Skip duplicate within import
            results["skipped"].append({
                "ip": node_data['ip'],
                "existing_id": None,
                "reason": "duplicate_in_import"
            })
            continue
        
        seen_in_import.add(node_key)
        unique_nodes.append(node_data)
    
    # STEP 2: Process unique nodes against database
    for node_data in unique_nodes:
        try:
            # Check for duplicates in database
            dup_result = check_node_duplicate(
                db, 
                node_data['ip'], 
                node_data['login'], 
                node_data['password']
            )
            
            if dup_result["action"] == "add":
                # Create new node - ensure default status is not_tested
                node_data_with_defaults = {**node_data}
                if 'status' not in node_data_with_defaults:
                    node_data_with_defaults['status'] = 'not_tested'
                
                new_node = Node(**node_data_with_defaults)
                new_node.last_update = datetime.utcnow()  # Set current time on creation
                db.add(new_node)
                db.flush()  # Get ID without committing
                results["added"].append({
                    "id": new_node.id,
                    "ip": node_data['ip'],
                    "reason": dup_result["reason"]
                })
            
            elif dup_result["action"] == "skip":
                results["skipped"].append({
                    "ip": node_data['ip'],
                    "existing_id": dup_result["existing_node"],
                    "reason": dup_result["reason"]
                })
            
            elif dup_result["action"] == "replace":
                # Create new node (old ones already deleted) - ensure default status is not_tested
                node_data_with_defaults = {**node_data}
                if 'status' not in node_data_with_defaults:
                    node_data_with_defaults['status'] = 'not_tested'
                
                new_node = Node(**node_data_with_defaults)
                new_node.last_update = datetime.utcnow()  # Set current time on creation
                db.add(new_node)
                db.flush()
                results["replaced"].append({
                    "id": new_node.id,
                    "ip": node_data['ip'],
                    "deleted_nodes": dup_result["deleted_nodes"],
                    "reason": dup_result["reason"]
                })
            
            elif dup_result["action"] == "queue":
                # Add to verification queue
                queue_id = create_verification_queue_entry(
                    db, node_data, dup_result["conflicting_nodes"]
                )
                results["queued"].append({
                    "queue_id": queue_id,
                    "ip": node_data['ip'],
                    "conflicting_nodes": dup_result["conflicting_nodes"],
                    "reason": dup_result["reason"]
                })
        
        except Exception as e:
            logger.error(f"Error processing node {node_data.get('ip', 'unknown')}: {str(e)}")
            results["errors"].append({
                "ip": node_data.get('ip', 'unknown'),
                "error": str(e)
            })
    
    # Write format errors to file
    if results['format_errors']:
        try:
            write_format_errors(results['format_errors'])
        except Exception as e:
            logger.error(f"Error writing format errors: {str(e)}")
    
    # Commit all changes
    try:
        db.commit()
    except Exception as e:
        logger.error(f"Database commit error: {str(e)}")
        db.rollback()
        results["errors"].append({"general": f"Database commit error: {str(e)}"})
    
    return results
def is_valid_ip(ip: str) -> bool:
    """Basic IP validation"""
    import ipaddress
    try:
        ipaddress.ip_address(ip)
        return True
    except ValueError:
        return False

@api_router.get("/format-errors")
async def get_format_errors(
    current_user: User = Depends(get_current_user)
):
    """Get format errors from file"""
    error_file_path = "/app/Format_error.txt"
    
    try:
        if not os.path.exists(error_file_path):
            return {"content": "", "message": "No format errors found"}
        
        with open(error_file_path, "r", encoding="utf-8") as f:
            content = f.read()
        
        return {"content": content, "message": "Format errors loaded successfully"}
    
    except Exception as e:
        return {"content": "", "message": f"Error reading format errors: {str(e)}"}

@api_router.delete("/format-errors")
async def clear_format_errors(
    current_user: User = Depends(get_current_user)
):
    """Clear format errors file"""
    error_file_path = "/app/Format_error.txt"
    
    try:
        if os.path.exists(error_file_path):
            os.remove(error_file_path)
        return {"message": "Format errors cleared successfully"}
    
    except Exception as e:
        return {"message": f"Error clearing format errors: {str(e)}"}
@api_router.get("/autocomplete/countries")
async def get_countries(
    q: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(Node.country).filter(Node.country != "").distinct()
    if q:
        query = query.filter(Node.country.ilike(f"%{q}%"))
    countries = [row[0] for row in query.limit(10).all()]
    return countries

@api_router.get("/autocomplete/states")
async def get_states(
    q: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(Node.state).filter(Node.state != "").distinct()
    if q:
        query = query.filter(Node.state.ilike(f"%{q}%"))
    states = [row[0] for row in query.limit(10).all()]
    return states

@api_router.get("/autocomplete/cities")
async def get_cities(
    q: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(Node.city).filter(Node.city != "").distinct()
    if q:
        query = query.filter(Node.city.ilike(f"%{q}%"))
    cities = [row[0] for row in query.limit(10).all()]
    return cities

@api_router.get("/autocomplete/providers")
async def get_providers(
    q: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(Node.provider).filter(Node.provider != "").distinct()
    if q:
        query = query.filter(Node.provider.ilike(f"%{q}%"))
    providers = [row[0] for row in query.limit(10).all()]
    return providers

# Statistics
@api_router.get("/stats")
async def get_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # OPTIMIZED: Single query with GROUP BY instead of multiple COUNT queries
    from sqlalchemy import func
    
    # Get status counts in one query
    status_counts = db.query(
        Node.status, func.count(Node.id).label('count')
    ).group_by(Node.status).all()
    
    status_dict = {status: count for status, count in status_counts}
    
    # Get protocol counts in one query
    protocol_counts = db.query(
        Node.protocol, func.count(Node.id).label('count')
    ).group_by(Node.protocol).all()
    
    protocol_dict = {protocol: count for protocol, count in protocol_counts}
    
    # Get total
    total_nodes = sum(status_dict.values())
    
    return {
        "total": total_nodes,
        "not_tested": status_dict.get("not_tested", 0),
        "ping_failed": status_dict.get("ping_failed", 0),
        "ping_ok": status_dict.get("ping_ok", 0),
        "speed_ok": status_dict.get("speed_ok", 0),
        "offline": status_dict.get("offline", 0),
        "online": status_dict.get("online", 0),
        "by_protocol": {
            "pptp": protocol_dict.get("pptp", 0),
            "ssh": protocol_dict.get("ssh", 0),
            "socks": protocol_dict.get("socks", 0),
            "server": protocol_dict.get("server", 0),
            "ovpn": protocol_dict.get("ovpn", 0),
        }
    }

@api_router.get("/progress/{session_id}")
async def get_progress_stream(session_id: str, current_user: User = Depends(get_current_user)):
    """Server-Sent Events endpoint for real-time progress updates"""
    
    async def event_generator():
        while True:
            if session_id in progress_store:
                progress = progress_store[session_id]
                data = json.dumps(progress.to_dict())
                yield f"data: {data}\n\n"
                
                # If completed or failed, break the loop
                if progress.status in ["completed", "failed", "cancelled"]:
                    break
            else:
                # Session not found, send empty progress
                yield f"data: {json.dumps({'error': 'Session not found'})}\n\n"
                break
            
            await asyncio.sleep(0.5)  # Update every 500ms
    
    return StreamingResponse(
        event_generator(), 
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@api_router.post("/progress/{session_id}/cancel")
async def cancel_progress(session_id: str, current_user: User = Depends(get_current_user)):
    """Cancel ongoing operation"""
    if session_id in progress_store:
        progress_store[session_id].status = "cancelled"
        return {"success": True, "message": "Operation cancelled"}
    return {"success": False, "message": "Session not found"}

# Service Management Routes
@api_router.post("/services/start")
async def start_services(
    action: ServiceAction,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Start PPTP + SOCKS services for selected nodes"""
    results = []
    
    for node_id in action.node_ids:
        # Get node data
        node = db.query(Node).filter(Node.id == node_id).first()
        if not node:
            results.append({
                "node_id": node_id,
                "success": False,
                "message": "Node not found"
            })
            continue
        
        try:
            # Start PPTP connection
            pptp_result = await service_manager.start_pptp_connection(
                node_id, node.ip, node.login, node.password
            )
            
            if pptp_result['success']:
                interface = pptp_result['interface']
                
                # Start SOCKS server on the PPTP interface
                socks_result = await service_manager.start_socks_server(
                    node_id, interface
                )
                
                if socks_result['success']:
                    # Update node status to online only if all previous steps passed
                    if node.status in ["ping_ok", "speed_ok"]:
                        node.status = "online"
                        node.last_update = datetime.utcnow()  # Update time when online
                    # Note: Database will auto-commit via get_db() dependency
                    
                    results.append({
                        "node_id": node_id,
                        "success": True,
                        "pptp": pptp_result,
                        "socks": socks_result,
                        "message": f"PPTP + SOCKS started on {interface}:{socks_result['port']}"
                    })
                else:
                    # Service failed to start properly - preserve speed_ok status
                    if node.status == "speed_ok":
                        # Don't downgrade speed_ok nodes - keep for retry
                        logger.info(f"SOCKS failed for speed_ok node {node_id}, preserving status")
                        pass  # Keep current status
                    else:
                        node.status = "offline"
                    logger.info(f"Node {node_id} status after SOCKS failure: {node.status}")
                    node.last_update = datetime.utcnow()  # Update time
                    # Note: Database will auto-commit via get_db() dependency
                    results.append({
                        "node_id": node_id,
                        "success": False,
                        "pptp": pptp_result,
                        "socks": socks_result,
                        "status": node.status,
                        "message": f"PPTP OK, SOCKS failed - status remains {node.status}"
                    })
            else:
                # PPTP connection failed - preserve original status if it was speed_ok
                if node.status == "speed_ok":
                    # Don't downgrade speed_ok nodes - keep for retry
                    logger.info(f"PPTP failed for speed_ok node {node_id}, preserving status")
                    pass  # Keep current status
                else:
                    node.status = "offline"
                logger.info(f"Node {node_id} status after PPTP failure: {node.status}")
                node.last_update = datetime.utcnow()  # Update time
                # Note: get_db() will auto-commit
                results.append({
                    "node_id": node_id,
                    "success": False,
                    "pptp": pptp_result,
                    "status": node.status,
                    "message": f"PPTP connection failed - status remains {node.status}"
                })
                
        except Exception as e:
            # Don't change status on exception - preserve speed_ok if it exists
            results.append({
                "node_id": node_id,
                "success": False,
                "status": node.status,
                "message": f"Service start error: {str(e)} - status remains {node.status}"
            })
    
    return {"results": results}

@api_router.post("/services/stop")
async def stop_services(
    action: ServiceAction,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Stop services for selected nodes"""
    results = []
    
    for node_id in action.node_ids:
        try:
            result = await service_manager.stop_services(node_id)
            
            if result['success']:
                # Update node status
                node = db.query(Node).filter(Node.id == node_id).first()
                if node:
                    node.status = "offline"
                    node.last_update = datetime.utcnow()  # Update time when stopped
                    # Note: get_db() will auto-commit
            
            results.append({
                "node_id": node_id,
                "success": result['success'],
                "message": result['message']
            })
            
        except Exception as e:
            results.append({
                "node_id": node_id,
                "success": False,
                "message": f"Service stop error: {str(e)}"
            })
    
    return {"results": results}

@api_router.get("/services/status/{node_id}")
async def get_service_status(
    node_id: int,
    current_user: User = Depends(get_current_user)
):
    """Get service status for a specific node"""
    try:
        status = await service_manager.get_service_status(node_id)
        return status
    except Exception as e:
        return {"error": str(e)}

# Network Testing Routes  
@api_router.post("/test/ping")
async def test_ping(
    test_request: TestRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Test ping for selected nodes - preserves speed_ok status"""
    results = []
    
    for node_id in test_request.node_ids:
        node = db.query(Node).filter(Node.id == node_id).first()
        if not node:
            results.append({
                "node_id": node_id,
                "success": False,
                "message": "Node not found"
            })
            continue
        
        # CRITICAL: Save original status BEFORE any changes
        original_status = node.status
        logger.info(f"🔍 Test ping: Node {node_id} original status: {original_status}")
        
        # NEVER test speed_ok nodes
        if original_status == "speed_ok":
            logger.info(f"✅ Test ping: Node {node_id} has speed_ok - SKIPPING to preserve status")
            results.append({
                "node_id": node_id,
                "ip": node.ip,
                "success": True,
                "status": "speed_ok",
                "message": "Node has speed_ok status - test skipped to preserve validation"
            })
            continue
        
        try:
            # Set status to checking
            node.status = "checking"
            node.last_check = datetime.utcnow()
            node.last_update = datetime.utcnow()
            # Note: get_db() will auto-commit
            
            ping_result = await network_tester.ping_test(node.ip)
            
            # Update status based on ping result
            if ping_result['reachable']:
                node.status = "ping_ok"
                logger.info(f"✅ Test ping: Node {node_id} SUCCESS - {original_status} -> ping_ok")
            else:
                node.status = "ping_failed"
                logger.info(f"❌ Test ping: Node {node_id} FAILED - {original_status} -> ping_failed")
            
            node.last_update = datetime.utcnow()
            # Note: get_db() will auto-commit
            
            results.append({
                "node_id": node_id,
                "ip": node.ip,
                "success": ping_result['success'],
                "status": node.status,
                "original_status": original_status,
                "ping": ping_result
            })
            
        except Exception as e:
            # On error, NEVER downgrade speed_ok
            if original_status != "speed_ok":
                node.status = "offline"
                logger.error(f"❌ Test ping: Node {node_id} ERROR - {original_status} -> offline - {str(e)}")
            else:
                node.status = "speed_ok"
                logger.error(f"❌ Test ping: Node {node_id} ERROR but PROTECTED - preserving speed_ok - {str(e)}")
            node.last_update = datetime.utcnow()
            # Note: get_db() will auto-commit
            
            results.append({
                "node_id": node_id,
                "success": False,
                "status": node.status,
                "original_status": original_status,
                "message": f"Ping test error: {str(e)}"
            })
    
    return {"results": results}

@api_router.post("/test/speed")
async def test_speed(
    test_request: TestRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Test speed for selected nodes (requires active connection)"""
    results = []
    
    for node_id in test_request.node_ids:
        node = db.query(Node).filter(Node.id == node_id).first()
        if not node:
            results.append({
                "node_id": node_id,
                "success": False,
                "message": "Node not found"
            })
            continue
        
        try:
            # Check if service is active
            service_status = await service_manager.get_service_status(node_id)
            
            if not service_status['active']:
                results.append({
                    "node_id": node_id,
                    "success": False,
                    "message": "Service not active - start PPTP connection first"
                })
                continue
            
            interface = service_status.get('interface')
            speed_result = await network_tester.speed_test(interface)
            
            results.append({
                "node_id": node_id,
                "ip": node.ip,
                "success": speed_result['success'],
                "speed": speed_result,
                "interface": interface
            })
            
        except Exception as e:
            results.append({
                "node_id": node_id,
                "success": False,
                "message": f"Speed test error: {str(e)}"
            })
    
    return {"results": results}

@api_router.post("/test/combined") 
async def test_combined(
    test_request: TestRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Combined test (ping + speed) for selected nodes"""
    results = []
    
    for node_id in test_request.node_ids:
        node = db.query(Node).filter(Node.id == node_id).first()
        if not node:
            results.append({
                "node_id": node_id,
                "success": False,
                "message": "Node not found"
            })
            continue
        
        try:
            # Set status to checking
            node.status = "checking"
            node.last_check = datetime.utcnow()
            node.last_update = datetime.utcnow()  # Update time when status changes
            db.commit()
            
            # Get interface if service is active
            service_status = await service_manager.get_service_status(node_id)
            interface = service_status.get('interface') if service_status['active'] else None
            
            # Run combined test
            combined_result = await network_tester.combined_test(
                node.ip, interface, test_request.test_type
            )
            
            # Update node status
            node.status = combined_result['overall']
            node.last_update = datetime.utcnow()  # Update time after test
            db.commit()
            
            results.append({
                "node_id": node_id,
                "ip": node.ip,
                "success": True,
                "test": combined_result
            })
            
        except Exception as e:
            # Reset status on error
            node.status = "offline"
            node.last_update = datetime.utcnow()  # Update time on error
            db.commit()
            
            results.append({
                "node_id": node_id,
                "success": False,
                "message": f"Combined test error: {str(e)}"
            })
    
    return {"results": results}

# Auto-test new nodes on creation
@api_router.post("/nodes/auto-test")
async def create_node_with_test(
    node: NodeCreate,
    test_type: str = "ping",  # ping, speed, both
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create node and automatically test it"""
    # Create node first
    db_node = Node(**node.dict())
    db_node.status = "checking"
    db_node.last_update = datetime.utcnow()  # Set time on creation
    db.add(db_node)
    db.commit()
    db.refresh(db_node)
    
    try:
        # Run test based on type
        if test_type == "ping":
            ping_result = await network_tester.ping_test(db_node.ip)
            if ping_result['reachable']:
                db_node.status = "ping_ok"
            else:
                db_node.status = "ping_failed"
            test_result = {"ping": ping_result}
            
        elif test_type == "speed":
            # Speed test only if current status allows it
            if db_node.status in ["ping_ok", "speed_ok", "online"]:
                # Skip testing if already speed_ok
                if db_node.status == "speed_ok":
                    speed_result = {"success": True, "download_speed": float(db_node.speed.replace(" Mbps", "")) if db_node.speed else 0, "message": "Already speed_ok"}
                else:
                    speed_result = await network_tester.speed_test()
                    if speed_result['success'] and speed_result.get('download_speed'):
                        if speed_result['download_speed'] > 1.0:
                            db_node.status = "speed_ok"
                        else:
                            # Don't downgrade to ping_failed - keep current status
                            pass  # Keep existing status
                    else:
                        # Keep existing status instead of ping_ok
                        pass  # Don't change status
            else:
                speed_result = {"success": False, "error": "Ping test required first"}
            test_result = {"speed": speed_result}
            
        else:  # both
            combined_result = await network_tester.combined_test(db_node.ip, None, "both")
            db_node.status = combined_result['overall']
            test_result = {"combined": combined_result}
        
        db_node.last_check = datetime.utcnow()
        db_node.last_update = datetime.utcnow()  # Update time after test
        db.commit()
        
        return {
            "node": db_node,
            "test_result": test_result,
            "message": f"Node created and tested ({test_type})"
        }
        
    except Exception as e:
        # Fallback to offline if test fails
        db_node.status = "offline"
        db_node.last_update = datetime.utcnow()  # Update time on error
        db.commit()
        
        return {
            "node": db_node,
            "test_result": {"error": str(e)},
            "message": f"Node created but test failed: {str(e)}"
        }

# Individual Node Actions
@api_router.post("/nodes/{node_id}/test")
async def test_single_node(
    node_id: int,
    test_type: str = "ping",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Test a single node"""
    node = db.query(Node).filter(Node.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    
    try:
        # Set status to checking
        node.status = "checking"
        node.last_check = datetime.utcnow()
        node.last_update = datetime.utcnow()  # Update time when status changes
        db.commit()
        
        if test_type == "ping":
            result = await network_tester.ping_test(node.ip)
            if result['reachable']:
                node.status = "ping_ok"
            else:
                node.status = "ping_failed"
        elif test_type == "speed":
            # Speed test only if node has passed ping test
            if node.status in ["ping_ok", "speed_ok", "online"]:
                service_status = await service_manager.get_service_status(node_id)
                interface = service_status.get('interface') if service_status['active'] else None
                result = await network_tester.speed_test(interface)
                if result['success'] and result.get('download_speed'):
                    if result['download_speed'] > 1.0:
                        node.status = "speed_ok"
                    else:
                        node.status = "ping_failed"
                else:
                    # Keep current status if speed test fails
                    pass
            else:
                result = {"success": False, "error": "Ping test required first"}
        else:  # both
            service_status = await service_manager.get_service_status(node_id)
            interface = service_status.get('interface') if service_status['active'] else None
            result = await network_tester.combined_test(node.ip, interface, "both")
            node.status = result['overall']
        
        node.last_update = datetime.utcnow()  # Update time after test
        db.commit()
        
        return {
            "success": True,
            "node_id": node_id,
            "test_type": test_type,
            "result": result,
            "status": node.status
        }
        
    except Exception as e:
        node.status = "offline"
        node.last_update = datetime.utcnow()  # Update time on error
        db.commit()
        return {"success": False, "message": str(e)}

@api_router.post("/nodes/{node_id}/services/start")
async def start_single_node_services(
    node_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Start services for a single node"""
    node = db.query(Node).filter(Node.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    
    try:
        # Start PPTP connection
        pptp_result = await service_manager.start_pptp_connection(
            node_id, node.ip, node.login, node.password
        )
        
        if pptp_result['success']:
            interface = pptp_result['interface']
            
            # Start SOCKS server
            socks_result = await service_manager.start_socks_server(
                node_id, interface
            )
            
            if socks_result['success']:
                node.status = "online"
                node.last_update = datetime.utcnow()  # Update time when online
                db.commit()
                
                return {
                    "success": True,
                    "node_id": node_id,
                    "pptp": pptp_result,
                    "socks": socks_result,
                    "message": f"Services started on {interface}:{socks_result['port']}"
                }
            else:
                return {
                    "success": False,
                    "message": "PPTP OK, SOCKS failed",
                    "pptp": pptp_result,
                    "socks": socks_result
                }
        else:
            return {
                "success": False,
                "message": "PPTP connection failed",
                "pptp": pptp_result
            }
            
    except Exception as e:
        return {"success": False, "message": str(e)}

@api_router.post("/nodes/{node_id}/services/stop")
async def stop_single_node_services(
    node_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Stop services for a single node"""
    node = db.query(Node).filter(Node.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    
    try:
        result = await service_manager.stop_services(node_id)
        
        if result['success']:
            node.status = "offline"
            node.last_update = datetime.utcnow()  # Update time when stopped
            db.commit()
        
        return {
            "success": result['success'],
            "node_id": node_id,
            "message": result['message']
        }
        
    except Exception as e:
        return {"success": False, "message": str(e)}

# ===== MANUAL TESTING WORKFLOW API ENDPOINTS =====
# These endpoints implement the user's required manual testing workflow:
# not_tested → ping_test → ping_ok/ping_failed  
# ping_ok → speed_test → speed_ok/ping_failed
# speed_ok → launch_services → online

@api_router.post("/manual/ping-test")
async def manual_ping_test(
    test_request: TestRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Manual ping test - works for any node status but preserves speed_ok"""
    results = []
    
    for node_id in test_request.node_ids:
        node = db.query(Node).filter(Node.id == node_id).first()
        if not node:
            results.append({
                "node_id": node_id,
                "success": False,
                "message": "Node not found"
            })
            continue
        
        # Store original status BEFORE any changes - CRITICAL for speed_ok preservation
        original_status = node.status
        logger.info(f"🔍 Node {node_id} ping test - original status: {original_status}")
        
        # CRITICAL PROTECTION: Never test speed_ok nodes - they already passed all tests
        if original_status == "speed_ok":
            logger.info(f"✅ Node {node_id} has speed_ok status - SKIPPING ping test to preserve status")
            results.append({
                "node_id": node_id,
                "ip": node.ip,
                "success": True,
                "status": "speed_ok",
                "original_status": original_status,
                "message": "Node already has speed_ok status - test skipped to preserve validation"
            })
            continue
        
        try:
            # Set status to checking during test (only for non-speed_ok nodes)
            node.status = "checking"
            node.last_check = datetime.utcnow()
            node.last_update = datetime.utcnow()
            # Note: get_db() will auto-commit
            
            # Perform fast multi-port TCP ping based on node config
            from ping_speed_test import multiport_tcp_ping
            ports = get_ping_ports_for_node(node)
            ping_result = await multiport_tcp_ping(node.ip, ports=ports, attempts=3, per_attempt_timeout=1.5)
            # Add packet_loss for UI compatibility (100 - success_rate)
            try:
                ping_result["packet_loss"] = round(100.0 - float(ping_result.get("success_rate", 0.0)), 1)
            except Exception:
                ping_result["packet_loss"] = 100.0 if not ping_result.get("success") else 0.0

            # Update status based on result
            if ping_result['success']:
                node.status = "ping_ok"
                logger.info(f"✅ Node {node_id} ping SUCCESS - status: {original_status} -> ping_ok")
            else:
                node.status = "ping_failed"
                logger.info(f"❌ Node {node_id} ping FAILED - status: {original_status} -> ping_failed")
            
            node.last_check = datetime.utcnow()
            node.last_update = datetime.utcnow()
            # Note: get_db() will auto-commit
            
            results.append({
                "node_id": node_id,
                "ip": node.ip,
                "success": bool(ping_result.get("success", False)),
                "status": node.status,
                "original_status": original_status,
                "ping_result": ping_result,
                "message": f"Ping test completed: {original_status} -> {node.status}"
            })
            
        except Exception as e:
            # On error, set to ping_failed ONLY if original status wasn't speed_ok
            if original_status != "speed_ok":
                node.status = "ping_failed"
                logger.error(f"❌ Node {node_id} ping ERROR - status: {original_status} -> ping_failed - Error: {str(e)}")
            else:
                node.status = "speed_ok"
                logger.error(f"❌ Node {node_id} ping ERROR but PRESERVING speed_ok - Error: {str(e)}")
            
            node.last_check = datetime.utcnow()
            node.last_update = datetime.utcnow()
            # Note: get_db() will auto-commit
            
            results.append({
                "node_id": node_id,
                "success": False,
                "status": node.status,
                "original_status": original_status,
                "message": f"Ping test error: {str(e)} - Status: {original_status} -> {node.status}"
            })
    
    return {"results": results}

@api_router.post("/manual/ping-test-batch")
async def manual_ping_test_batch(
    test_request: TestRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Optimized batch ping test with real-time progress tracking"""
    
    # Generate session ID for progress tracking
    session_id = str(uuid.uuid4())
    
    # Get all nodes first
    nodes = []
    for node_id in test_request.node_ids:
        node = db.query(Node).filter(Node.id == node_id).first()
        if node:
            nodes.append(node)
    
    if not nodes:
        return {"results": [], "session_id": session_id}
    
    # Initialize progress tracker
    progress = ProgressTracker(session_id, len(nodes))
    progress.update(0, f"Начинаем ping тестирование {len(nodes)} узлов...")
    
    # Start background batch testing
    asyncio.create_task(process_testing_batches(
        session_id, [n.id for n in nodes], "ping_only", db
    ))
    
    return {"results": [], "session_id": session_id, "message": f"Запущено тестирование {len(nodes)} узлов"}

# Removed incomplete process_ping_testing_batches function - using process_testing_batches instead

@api_router.post("/manual/ping-test-batch-progress")
async def manual_ping_test_batch_progress(
    test_request: TestRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Batch ping test with real-time progress tracking"""
    
    # Generate session ID for progress tracking
    session_id = str(uuid.uuid4())
    
    # Get all valid nodes
    nodes = []
    for node_id in test_request.node_ids:
        node = db.query(Node).filter(Node.id == node_id).first()
        if node:
            nodes.append(node)
    
    if not nodes:
        return {"session_id": session_id, "message": "Нет узлов для тестирования", "started": False}
    
    # Initialize progress tracker
    progress = ProgressTracker(session_id, len(nodes))
    progress.update(0, f"Начинаем ping тестирование {len(nodes)} узлов...")
    
    # Start background batch testing
    asyncio.create_task(process_testing_batches(
        session_id, [n.id for n in nodes], "ping_only", db
    ))
    
    return {"session_id": session_id, "message": f"Запущено тестирование {len(nodes)} узлов", "started": True}

@api_router.post("/manual/speed-test-batch-progress")
async def manual_speed_test_batch_progress(
    test_request: TestRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Batch speed test with real-time progress tracking"""
    
    # Generate session ID for progress tracking
    session_id = str(uuid.uuid4())
    
    # Get all valid nodes
    nodes = []
    for node_id in test_request.node_ids:
        node = db.query(Node).filter(Node.id == node_id).first()
        if node:
            nodes.append(node)
    
    if not nodes:
        return {"session_id": session_id, "message": "Нет узлов для тестирования", "started": False}
    
    # Initialize progress tracker
    progress = ProgressTracker(session_id, len(nodes))
    progress.update(0, f"Начинаем speed тестирование {len(nodes)} узлов...")
    
    # Start background batch testing
    asyncio.create_task(process_testing_batches(
        session_id, [n.id for n in nodes], "speed_only", db
    ))
    
    return {"session_id": session_id, "message": f"Запущено тестирование {len(nodes)} узлов", "started": True}

@api_router.post("/manual/ping-speed-test-batch-progress")
async def manual_ping_speed_test_batch_progress(
    test_request: TestRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Batch ping+speed test with real-time progress tracking"""
    
    # Generate session ID for progress tracking
    session_id = str(uuid.uuid4())
    
    # Get all valid nodes
    nodes = []
    for node_id in test_request.node_ids:
        node = db.query(Node).filter(Node.id == node_id).first()
        if node:
            nodes.append(node)
    
    if not nodes:
        return {"session_id": session_id, "message": "Нет узлов для тестирования", "started": False}
    
    # Initialize progress tracker
    progress = ProgressTracker(session_id, len(nodes))
    progress.update(0, f"Начинаем комбинированное тестирование {len(nodes)} узлов...")
    
    # Start background batch testing
    asyncio.create_task(process_testing_batches(
        session_id, [n.id for n in nodes], "ping_speed", db
    ))
    
    return {"session_id": session_id, "message": f"Запущено тестирование {len(nodes)} узлов", "started": True}

async def process_testing_batches(session_id: str, node_ids: list, testing_mode: str, db_session):
    """Process testing in batches for any test type"""
    
    BATCH_SIZE = 15  # Process 15 nodes at a time
    total_nodes = len(node_ids)
    processed_nodes = 0
    failed_tests = 0
    
    try:
        # Get fresh database session for background processing
        db = SessionLocal()
        
        logger.info(f"🚀 Testing Batch: Starting {total_nodes} nodes in batches of {BATCH_SIZE}, mode: {testing_mode}")
        
        # Import testing functions
        from ping_speed_test import test_node_ping, test_node_speed
        
        # Process nodes in batches
        for batch_start in range(0, total_nodes, BATCH_SIZE):
            batch_end = min(batch_start + BATCH_SIZE, total_nodes)
            current_batch = node_ids[batch_start:batch_end]
            
            logger.info(f"📦 Testing batch {batch_start//BATCH_SIZE + 1}: nodes {batch_start+1}-{batch_end}")
            
            # Check if operation was cancelled
            if session_id in progress_store and progress_store[session_id].status == "cancelled":
                logger.info(f"🚫 Testing cancelled by user for session {session_id}")
                break
            
            # Process current batch
            for i, node_id in enumerate(current_batch):
                global_index = batch_start + i
                
                # Check cancellation frequently
                if session_id in progress_store and progress_store[session_id].status == "cancelled":
                    break
                
                try:
                    node = db.query(Node).filter(Node.id == node_id).first()
                    if not node:
                        logger.warning(f"❌ Testing batch: Node {node_id} not found in database")
                        failed_tests += 1
                        continue
                    
                    # Update progress
                    if session_id in progress_store:
                        progress_store[session_id].update(
                            global_index, 
                            f"Тестирование {node.ip} ({global_index+1}/{total_nodes})"
                        )
                    
                    # Save original status
                    original_status = node.status
                    logger.info(f"🔍 Testing batch: Node {node.id} ({node.ip}) original status: {original_status}")
                    
                    # Skip speed_ok nodes to preserve validation
                    if original_status == "speed_ok":
                        logger.info(f"✅ Testing: Node {node.id} has speed_ok - SKIPPING test to preserve status")
                        processed_nodes += 1
                        continue
                    
                    # Set checking status and commit
                    node.status = "checking"
                    node.last_update = datetime.utcnow()
                    db.commit()
                    
                    try:
                        # Ping test
                        if testing_mode in ["ping_only", "ping_speed"]:
                            logger.info(f"🔍 Testing: Starting multi-port TCP ping for Node {node.id}")
                            from ping_speed_test import multiport_tcp_ping
                            ports = get_ping_ports_for_node(node)
                            ping_result = await multiport_tcp_ping(node.ip, ports=ports, attempts=3, per_attempt_timeout=1.5)

                            if ping_result.get('success'):
                                node.status = "ping_ok"
                                logger.info(f"✅ Testing: Node {node.id} ping SUCCESS")
                            else:
                                node.status = "ping_failed"
                                logger.info(f"❌ Testing: Node {node.id} ping FAILED")
                            # Maintain approximate compatibility for UI fields
                            try:
                                ping_result["packet_loss"] = round(100.0 - float(ping_result.get("success_rate", 0.0)), 1)
                            except Exception:
                                ping_result["packet_loss"] = 100.0 if not ping_result.get("success") else 0.0

                            node.last_update = datetime.utcnow()
                            db.commit()
                        
                        # Speed test
                        if testing_mode in ["speed_only", "ping_speed"]:
                            should_speed_test = (testing_mode == "speed_only" or node.status == "ping_ok")
                            
                            if should_speed_test:
                                logger.info(f"🔍 Testing: Starting speed test for Node {node.id}")
                                speed_result = await test_node_speed(node.ip)
                                
                                if speed_result['success'] and speed_result.get('download_speed'):
                                    download_speed = speed_result['download_speed']
                                    node.speed = f"{download_speed:.1f}"
                                    
                                    if download_speed > 1.0:
                                        node.status = "speed_ok"
                                        logger.info(f"✅ Testing: Node {node.id} speed OK ({download_speed:.1f} Mbps)")
                                    else:
                                        node.status = "ping_ok" if testing_mode == "ping_speed" else "ping_failed"
                                        logger.info(f"⚠️ Testing: Node {node.id} speed SLOW ({download_speed:.1f} Mbps)")
                                else:
                                    if testing_mode == "speed_only":
                                        node.status = "ping_failed"
                                    logger.info(f"❌ Testing: Node {node.id} speed test FAILED")
                                
                                node.last_update = datetime.utcnow()
                                db.commit()
                        
                        node.last_check = datetime.utcnow()
                        db.commit()
                        processed_nodes += 1
                        
                        # Update progress with success
                        if session_id in progress_store:
                            result_info = {
                                "node_id": node.id,
                                "ip": node.ip,
                                "status": node.status,
                                "success": True
                            }
                            progress_store[session_id].update(
                                global_index + 1, 
                                f"✅ {node.ip} - {node.status}", 
                                result_info
                            )
                    
                    except asyncio.TimeoutError:
                        logger.warning(f"⏱️ Testing: Node {node.id} test TIMEOUT - reverting to {original_status}")
                        node.status = original_status
                        node.last_update = datetime.utcnow()
                        db.commit()
                        failed_tests += 1
                        
                        if session_id in progress_store:
                            progress_store[session_id].update(global_index + 1, f"⏱️ {node.ip} - timeout")
                    
                    except Exception as test_error:
                        logger.error(f"❌ Testing: Node {node.id} test ERROR: {str(test_error)} - reverting to {original_status}")
                        node.status = original_status
                        node.last_update = datetime.utcnow()
                        db.commit()
                        failed_tests += 1
                        
                        if session_id in progress_store:
                            progress_store[session_id].update(global_index + 1, f"❌ {node.ip} - error")
                
                except Exception as node_error:
                    logger.error(f"❌ Testing: Critical error processing Node {node_id}: {str(node_error)}")
                    failed_tests += 1
            
            # Force commit after each batch and clear session cache
            try:
                db.commit()
                db.expunge_all()  # Clear session cache to free memory
            except Exception as commit_error:
                logger.error(f"❌ Testing batch commit error: {commit_error}")
                db.rollback()
            
            # Small delay between batches to prevent system overload
            await asyncio.sleep(2)
            
            logger.info(f"✅ Testing batch {batch_start//BATCH_SIZE + 1} completed: {len(current_batch)} nodes processed")
    
    except Exception as e:
        logger.error(f"❌ Testing batch processing error: {str(e)}", exc_info=True)
        if session_id in progress_store:
            progress_store[session_id].complete("failed")
    
    finally:
        # Complete progress tracking
        if session_id in progress_store:
            progress_store[session_id].complete("completed")
            progress_store[session_id].update(
                total_nodes, 
                f"Тестирование завершено: {processed_nodes} успешно, {failed_tests} ошибок"
            )
        
        # Cleanup any remaining nodes stuck in "checking" status
        try:
            stuck_nodes = db.query(Node).filter(Node.status == "checking").all()
            if stuck_nodes:
                logger.warning(f"🧹 Testing: Cleaning up {len(stuck_nodes)} nodes stuck in 'checking' status")
                for stuck_node in stuck_nodes:
                    stuck_node.status = "not_tested"
                    stuck_node.last_update = datetime.utcnow()
                db.commit()
        except Exception as cleanup_error:
            logger.error(f"❌ Testing cleanup error: {cleanup_error}")
        
        db.close()
        
        logger.info(f"📊 Testing batch processing completed: {processed_nodes} processed, {failed_tests} failed")

@api_router.post("/manual/ping-speed-test-batch")
async def manual_ping_speed_test_batch(
    test_request: TestRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Optimized batch ping + speed test with sequential execution"""
    import asyncio
    from ping_speed_test import test_node_ping, test_node_speed
    
    # Get all nodes first
    nodes = []
    for node_id in test_request.node_ids:
        node = db.query(Node).filter(Node.id == node_id).first()
        if node:
            nodes.append(node)
    
    if not nodes:
        return {"results": []}
    
    # Sequential execution: ping first, then speed only for successful pings
    async def test_single_node_combined(node):
        original_status = getattr(node, 'original_status', 'not_tested')
        
        try:
            # Step 1: Ping test
            node.status = "checking"
            node.last_check = datetime.utcnow()
            node.last_update = datetime.utcnow()
            db.commit()
            
            ping_result = await asyncio.wait_for(
                test_node_ping(node.ip, fast_mode=True),
                timeout=12.0
            )
            
            if not ping_result or not ping_result.get('success', False):
                # Ping failed - preserve speed_ok status
                if node.status != "speed_ok":
                    node.status = "ping_failed"
                node.last_check = datetime.utcnow()
                node.last_update = datetime.utcnow()
                db.commit()
                
                return {
                    "node_id": node.id,
                    "ip": node.ip,
                    "success": False,
                    "status": node.status,
                    "original_status": original_status,
                    "ping_result": ping_result,
                    "message": f"Ping failed: {original_status} -> {node.status}"
                }
            
            # Step 2: Ping successful, now test speed
            node.status = "ping_ok"
            node.last_update = datetime.utcnow()
            
            # Note: Database will auto-commit via get_db() dependency
            
            # Small delay before speed test
            await asyncio.sleep(0.5)
            
            speed_result = await asyncio.wait_for(
                test_node_speed(node.ip),
                timeout=15.0
            )
            
            # Update final status based on speed result
            if speed_result and speed_result.get('success', False):
                node.status = "speed_ok"
                node.speed = f"{speed_result.get('download', 0)} Mbps"
            else:
                # Speed failed - preserve existing speed_ok status
                if node.status != "speed_ok":
                    node.status = "ping_failed"
            
            node.last_check = datetime.utcnow()
            node.last_update = datetime.utcnow()
            
            # Note: Database will auto-commit via get_db() dependency
            
            return {
                "node_id": node.id,
                "ip": node.ip,
                "success": True,
                "status": node.status,
                "original_status": original_status,
                "ping_result": ping_result,
                "speed_result": speed_result,
                "message": f"Combined test: {original_status} -> {node.status}"
            }
            
        except asyncio.TimeoutError:
            # Preserve speed_ok status on timeout
            if node.status != "speed_ok":
                node.status = "ping_failed"
            node.last_check = datetime.utcnow()
            node.last_update = datetime.utcnow()
            db.commit()
            
            return {
                "node_id": node.id,
                "ip": node.ip,
                "success": False,
                "status": node.status,
                "original_status": original_status,
                "message": f"Combined test timeout: {original_status} -> {node.status}"
            }
            
        except Exception as e:
            # Preserve speed_ok status on exception
            if node.status != "speed_ok":
                node.status = "ping_failed"
            node.last_check = datetime.utcnow()
            node.last_update = datetime.utcnow()
            db.commit()
            
            return {
                "node_id": node.id,
                "ip": node.ip,
                "success": False,
                "status": node.status,
                "original_status": original_status,
                "message": f"Combined test error: {str(e)}"
            }
    
    # Run tests with limited concurrency for stability
    semaphore = asyncio.Semaphore(4)  # Only 4 concurrent combined tests
    
    async def limited_combined_test(node):
        async with semaphore:
            return await test_single_node_combined(node)
    
    try:
        # Execute all tests with dynamic timeout
        batch_timeout = max(120.0, len(nodes) * 5.0)  # 120s minimum or 5s per node for combined tests
        results = await asyncio.wait_for(
            asyncio.gather(*[limited_combined_test(node) for node in nodes]),
            timeout=batch_timeout
        )
        
    except asyncio.TimeoutError:
        # If entire batch times out, ensure no nodes remain in 'checking' status
        results = []
        for node in nodes:
            # Don't downgrade from any successful status to ping_failed
            if node.status not in ["speed_ok", "ping_ok", "online"]:
                node.status = "ping_failed"
                node.last_check = datetime.utcnow()
                node.last_update = datetime.utcnow()
                
            results.append({
                "node_id": node.id,
                "ip": node.ip,
                "success": False,
                "status": node.status,
                "message": "Batch operation timed out"
            })
    
    # Ensure all database changes are committed
    try:
        db.commit()
    except Exception as e:
        print(f"Database commit error in combined test: {e}")
        db.rollback()
    
    return {"results": results}

@api_router.post("/manual/speed-test")
async def manual_speed_test(
    test_request: TestRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Manual speed test - only for ping_ok nodes"""
    results = []
    
    for node_id in test_request.node_ids:
        node = db.query(Node).filter(Node.id == node_id).first()
        if not node:
            results.append({
                "node_id": node_id,
                "success": False,
                "message": "Node not found"
            })
            continue
        
        # Check if node is in correct status for speed test
        if node.status != "ping_ok":
            results.append({
                "node_id": node_id,
                "success": False,
                "message": f"Node status is '{node.status}', expected 'ping_ok'"
            })
            continue
        
        try:
            # Set status to checking during test
            node.status = "checking"
            node.last_check = datetime.utcnow()
            node.last_update = datetime.utcnow()  # Update time when status changes
            db.commit()
            
            # Perform real speed test
            from ping_speed_test import test_node_speed
            speed_result = await test_node_speed(node.ip)
            
            if speed_result['success'] and speed_result.get('download'):
                node.speed = f"{speed_result['download']:.1f}"
                node.status = "speed_ok"  # Any successful speed test = speed_ok
            else:
                # Speed test failed - preserve existing speed_ok status if node already has it
                if node.status != "speed_ok":
                    node.status = "ping_failed"
                node.speed = None
            
            node.last_check = datetime.utcnow()
            node.last_update = datetime.utcnow()  # Update time after test
            
            # CRITICAL: Immediate database save after each test completion
            try:
                db.commit()
            except Exception as commit_error:
                print(f"Speed test commit error for node {node_id}: {commit_error}")
                # Continue processing even if commit fails
            
            results.append({
                "node_id": node_id,
                "ip": node.ip,
                "success": True,
                "status": node.status,
                "speed": node.speed,
                "speed_result": speed_result,
                "message": f"Speed test completed: {node.status}"
            })
            
        except Exception as e:
            # On error, preserve speed_ok status
            if node.status != "speed_ok":
                node.status = "ping_failed"
            node.last_check = datetime.utcnow()
            node.last_update = datetime.utcnow()  # Update time on error
            db.commit()
            
            results.append({
                "node_id": node_id,
                "success": False,
                "message": f"Speed test error: {str(e)}"
            })
    
    return {"results": results}

@api_router.post("/manual/launch-services")
async def manual_launch_services(
    test_request: TestRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Manual service launch - only for speed_ok nodes"""
    results = []
    
    for node_id in test_request.node_ids:
        node = db.query(Node).filter(Node.id == node_id).first()
        if not node:
            results.append({
                "node_id": node_id,
                "success": False,
                "message": "Node not found"
            })
            continue
        
        # Check if node is in correct status for service launch
        if node.status != "speed_ok":
            results.append({
                "node_id": node_id,
                "success": False,
                "message": f"Node status is '{node.status}', expected 'speed_ok'"
            })
            continue
        
        try:
            # Set status to checking during service launch
            node.status = "checking" 
            node.last_update = datetime.utcnow()  # Update time when status changes
            # Note: Database will auto-commit via get_db() dependency
            
            # Launch SOCKS + OVPN services simultaneously
            from ovpn_generator import ovpn_generator
            from ping_speed_test import test_pptp_connection
            
            # Test PPTP connection - skip ping check since node already passed speed_ok
            pptp_result = await test_pptp_connection(node.ip, node.login, node.password, skip_ping_check=True)
            
            if pptp_result['success']:
                # Generate SOCKS credentials
                socks_data = ovpn_generator.generate_socks_credentials(node.ip, node.login)
                
                # Generate OVPN configuration
                client_name = f"{node.login}_{node.ip.replace('.', '_')}"
                ovpn_config = ovpn_generator.generate_ovpn_config(node.ip, client_name, node.login)
                
                # Save SOCKS and OVPN data to database
                node.socks_ip = socks_data['ip']
                node.socks_port = socks_data['port']
                node.socks_login = socks_data['login'] 
                node.socks_password = socks_data['password']
                node.ovpn_config = ovpn_config
                
                # Service launch successful - set to online
                node.status = "online"
                node.last_check = datetime.utcnow()
                node.last_update = datetime.utcnow()  # Update time when online
                # Note: Database will auto-commit via get_db() dependency
                
                results.append({
                    "node_id": node_id,
                    "ip": node.ip,
                    "success": True,
                    "status": "online",
                    "pptp": pptp_result,
                    "socks": socks_data,
                    "ovpn_ready": True,
                    "message": f"Services launched successfully - SOCKS: {socks_data['ip']}:{socks_data['port']}"
                })
            else:
                # CRITICAL FIX: Don't downgrade speed_ok nodes to ping_failed
                # If service launch fails, keep them in speed_ok status for retry
                logger.info(f"PPTP failed for node {node_id}, preserving speed_ok status")
                node.status = "speed_ok"  # Maintain speed_ok status instead of ping_failed
                node.last_check = datetime.utcnow()
                node.last_update = datetime.utcnow()  # Update time
                logger.info(f"Node {node_id} status set to: {node.status}")
                # Note: Database will auto-commit via get_db() dependency
                
                results.append({
                    "node_id": node_id,
                    "ip": node.ip,
                    "success": False,
                    "status": "speed_ok",  # Keep status as speed_ok for retry
                    "message": f"Service launch failed but node remains speed_ok: {pptp_result.get('message', 'Unknown error')}"
                })
        
        except Exception as e:
            # CRITICAL FIX: On error, keep speed_ok status for nodes that passed tests
            logger.info(f"Exception in service launch for node {node_id}, preserving speed_ok status: {str(e)}")
            node.status = "speed_ok"  # Maintain speed_ok instead of ping_failed
            node.last_check = datetime.utcnow()
            node.last_update = datetime.utcnow()  # Update time on error
            logger.info(f"Node {node_id} status set to: {node.status}")
            # Note: Database will auto-commit via get_db() dependency
            
            results.append({
                "node_id": node_id,
                "ip": node.ip,
                "success": False,
                "status": "speed_ok",  # Keep status for retry
                "message": f"Service launch error but node remains speed_ok: {str(e)}"
            })
    
    return {"results": results}

# Include API router
app.include_router(api_router)

# Health check
@app.get("/health")
async def health_check():
    return {"status": "ok", "timestamp": datetime.utcnow()}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
