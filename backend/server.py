from fastapi import FastAPI, APIRouter, Depends, HTTPException, status, Request, File, UploadFile, Form
from fastapi.responses import JSONResponse, FileResponse
from starlette.middleware.sessions import SessionMiddleware
from starlette.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from typing import List, Optional
import os
import re
import json
import csv
import io
from datetime import datetime, timedelta
from pathlib import Path
import logging

# Local imports
from database import get_db, User, Node, create_tables, hash_password, verify_password
from auth import (
    create_access_token, authenticate_user, get_current_user, 
    get_current_user_optional, ACCESS_TOKEN_EXPIRE_MINUTES
)
from schemas import (
    UserCreate, NodeCreate, NodeUpdate, LoginRequest, ChangePasswordRequest,
    BulkImport, ExportRequest, Token, ServiceAction, TestRequest
)
from services import service_manager, network_tester

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
    query = db.query(Node)
    
    # Apply filters
    if ip:
        query = query.filter(Node.ip.ilike(f"%{ip}%"))
    if provider:
        query = query.filter(Node.provider.ilike(f"%{provider}%"))
    if country:
        query = query.filter(Node.country.ilike(f"%{country}%"))
    if state:
        query = query.filter(Node.state.ilike(f"%{state}%"))
    if city:
        query = query.filter(Node.city.ilike(f"%{city}%"))
    if zipcode:
        query = query.filter(Node.zipcode.ilike(f"%{zipcode}%"))
    if login:
        query = query.filter(Node.login.ilike(f"%{login}%"))
    if comment:
        query = query.filter(Node.comment.ilike(f"%{comment}%"))
    if status:
        query = query.filter(Node.status == status)
    if protocol:
        query = query.filter(Node.protocol == protocol)
    if only_online:
        query = query.filter(Node.status == "online")
    
    total_count = query.count()
    nodes = query.offset((page - 1) * limit).limit(limit).all()
    
    return {
        "nodes": nodes,
        "total": total_count,
        "page": page,
        "limit": limit,
        "total_pages": (total_count + limit - 1) // limit
    }

@api_router.post("/nodes")
async def create_node(
    node: NodeCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    db_node = Node(**node.dict())
    db.add(db_node)
    db.commit()
    db.refresh(db_node)
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
    node_ids: List[int],
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    deleted_count = db.query(Node).filter(Node.id.in_(node_ids)).delete(synchronize_session=False)
    db.commit()
    return {"message": f"Deleted {deleted_count} nodes successfully"}

# Import/Export Routes
@api_router.post("/import")
async def import_nodes(
    data: BulkImport,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Parse and import nodes from text data"""
    nodes_data = parse_nodes_text(data.data, data.protocol)
    
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
        "total_processed": len(nodes_data)
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

def parse_nodes_text(text: str, protocol: str = "pptp") -> List[dict]:
    """Parse different node text formats as per TZ requirements"""
    nodes = []
    blocks = re.split(r'\n\s*\n', text.strip())
    
    for block in blocks:
        block = block.strip()
        if not block:
            continue
            
        node_data = {"protocol": protocol, "status": "offline"}
        
        # Format A (key=value multiline)
        if "Ip:" in block or "IP:" in block:
            lines = block.split('\n')
            for line in lines:
                if ':' in line:
                    key, value = line.split(':', 1)
                    key, value = key.strip().lower(), value.strip()
                    if key in ['ip', 'host']:
                        node_data['ip'] = value
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
        
        # Format B (single line with spaces)
        elif len(block.split()) >= 3:
            parts = block.split()
            if len(parts) >= 3:
                node_data['ip'] = parts[0]
                node_data['login'] = parts[1]
                node_data['password'] = parts[2]
                if len(parts) >= 4:
                    node_data['state'] = normalize_state_code(parts[3])
        
        # Format C (with - and | separators)
        elif ' - ' in block and ' | ' in block:
            main_part = block.split(' | ')[0]
            parts = main_part.split(' - ')
            if len(parts) >= 3:
                node_data['ip'] = parts[0].strip()
                creds = parts[1].strip()
                if ':' in creds:
                    login, password = creds.split(':', 1)
                    node_data['login'] = login
                    node_data['password'] = password
                location = parts[2].strip()
                if '/' in location:
                    state, city = location.split('/', 1)
                    node_data['state'] = state.strip()
                    node_data['city'] = city.split()[0].strip()
                    # Extract ZIP if present
                    zip_match = re.search(r'\d{5}', location)
                    if zip_match:
                        node_data['zipcode'] = zip_match.group()
        
        # Format D (colon separated)
        elif block.count(':') >= 2:
            parts = block.split(':')
            if len(parts) >= 3:
                node_data['ip'] = parts[0]
                node_data['login'] = parts[1]
                node_data['password'] = parts[2]
                if len(parts) >= 4:
                    node_data['country'] = normalize_country_code(parts[3])
                if len(parts) >= 5:
                    node_data['state'] = parts[4]
                if len(parts) >= 6:
                    node_data['zipcode'] = parts[5]
        
        # Format E/F (Location parsing)
        elif "Location:" in block:
            lines = block.split('\n')
            for line in lines:
                line = line.strip()
                if line.startswith("IP:"):
                    node_data['ip'] = line.split(':', 1)[1].strip()
                elif line.startswith("Credentials:"):
                    creds = line.split(':', 1)[1].strip()
                    if ':' in creds:
                        login, password = creds.split(':', 1)
                        node_data['login'] = login
                        node_data['password'] = password
                elif line.startswith("Location:"):
                    location = line.split(':', 1)[1].strip()
                    # Parse "Texas (Austin)" format
                    if '(' in location and ')' in location:
                        state = location.split('(')[0].strip()
                        city = location.split('(')[1].split(')')[0].strip()
                        node_data['state'] = state
                        node_data['city'] = city
                elif line.startswith("ZIP:"):
                    node_data['zipcode'] = line.split(':', 1)[1].strip()
        
        # Minimal format G (IP Login Pass)
        else:
            parts = block.split()
            if len(parts) >= 3:
                node_data['ip'] = parts[0]
                node_data['login'] = parts[1] 
                node_data['password'] = parts[2]
        
        # Validate IP and add node
        if 'ip' in node_data and is_valid_ip(node_data['ip']):
            nodes.append(node_data)
    
    return nodes

def normalize_state_code(code: str) -> str:
    """Convert state codes to full names"""
    states = {
        "CA": "California", "NY": "New York", "TX": "Texas", "FL": "Florida",
        "NJ": "New Jersey", "IL": "Illinois", "OH": "Ohio", "PA": "Pennsylvania",
        "MI": "Michigan", "GA": "Georgia", "NC": "North Carolina", "VA": "Virginia",
        "WA": "Washington", "AZ": "Arizona", "MA": "Massachusetts", "TN": "Tennessee",
        "IN": "Indiana", "MO": "Missouri", "MD": "Maryland", "WI": "Wisconsin",
        "CO": "Colorado", "MN": "Minnesota", "SC": "South Carolina", "AL": "Alabama",
        "LA": "Louisiana", "KY": "Kentucky", "OR": "Oregon", "OK": "Oklahoma",
        "CT": "Connecticut", "IA": "Iowa", "MS": "Mississippi", "AR": "Arkansas",
        "UT": "Utah", "KS": "Kansas", "NV": "Nevada", "NM": "New Mexico",
        "NE": "Nebraska", "WV": "West Virginia", "ID": "Idaho", "HI": "Hawaii",
        "NH": "New Hampshire", "ME": "Maine", "MT": "Montana", "RI": "Rhode Island",
        "DE": "Delaware", "SD": "South Dakota", "ND": "North Dakota", "AK": "Alaska",
        "VT": "Vermont", "WY": "Wyoming"
    }
    return states.get(code.upper(), code)

def normalize_country_code(code: str) -> str:
    """Convert country codes to full names"""
    countries = {
        "US": "United States", "USA": "United States", "GB": "Great Britain",
        "UK": "United Kingdom", "CA": "Canada", "AU": "Australia",
        "DE": "Germany", "FR": "France", "IT": "Italy", "ES": "Spain",
        "NL": "Netherlands", "BE": "Belgium", "CH": "Switzerland",
        "SE": "Sweden", "NO": "Norway", "DK": "Denmark", "FI": "Finland"
    }
    return countries.get(code.upper(), code)

def is_valid_ip(ip: str) -> bool:
    """Basic IP validation"""
    import ipaddress
    try:
        ipaddress.ip_address(ip)
        return True
    except ValueError:
        return False

# Autocomplete/suggestions
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
    total_nodes = db.query(Node).count()
    online_nodes = db.query(Node).filter(Node.status == "online").count()
    offline_nodes = db.query(Node).filter(Node.status == "offline").count()
    checking_nodes = db.query(Node).filter(Node.status == "checking").count()
    
    return {
        "total": total_nodes,
        "online": online_nodes,
        "offline": offline_nodes,
        "checking": checking_nodes,
        "by_protocol": {
            "pptp": db.query(Node).filter(Node.protocol == "pptp").count(),
            "ssh": db.query(Node).filter(Node.protocol == "ssh").count(),
            "socks": db.query(Node).filter(Node.protocol == "socks").count(),
            "server": db.query(Node).filter(Node.protocol == "server").count(),
            "ovpn": db.query(Node).filter(Node.protocol == "ovpn").count(),
        }
    }

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
                    # Update node status
                    node.status = "online"
                    db.commit()
                    
                    results.append({
                        "node_id": node_id,
                        "success": True,
                        "pptp": pptp_result,
                        "socks": socks_result,
                        "message": f"PPTP + SOCKS started on {interface}:{socks_result['port']}"
                    })
                else:
                    results.append({
                        "node_id": node_id,
                        "success": False,
                        "pptp": pptp_result,
                        "socks": socks_result,
                        "message": "PPTP OK, SOCKS failed"
                    })
            else:
                results.append({
                    "node_id": node_id,
                    "success": False,
                    "pptp": pptp_result,
                    "message": "PPTP connection failed"
                })
                
        except Exception as e:
            results.append({
                "node_id": node_id,
                "success": False,
                "message": f"Service start error: {str(e)}"
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
                    db.commit()
            
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
    """Test ping for selected nodes"""
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
            db.commit()
            
            ping_result = await network_tester.ping_test(node.ip)
            
            # Update status based on ping result
            if ping_result['reachable']:
                node.status = "online"
            else:
                node.status = "offline"
            
            db.commit()
            
            results.append({
                "node_id": node_id,
                "ip": node.ip,
                "success": ping_result['success'],
                "ping": ping_result
            })
            
        except Exception as e:
            # Reset status on error
            node.status = "offline"
            db.commit()
            
            results.append({
                "node_id": node_id,
                "success": False,
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
    db.add(db_node)
    db.commit()
    db.refresh(db_node)
    
    try:
        # Run test based on type
        if test_type == "ping":
            ping_result = await network_tester.ping_test(db_node.ip)
            db_node.status = "online" if ping_result['reachable'] else "offline"
            test_result = {"ping": ping_result}
            
        elif test_type == "speed":
            # Speed test without connection (using default interface)
            speed_result = await network_tester.speed_test()
            db_node.status = "online" if speed_result['success'] else "degraded"
            test_result = {"speed": speed_result}
            
        else:  # both
            combined_result = await network_tester.combined_test(db_node.ip, None, "both")
            db_node.status = combined_result['overall']
            test_result = {"combined": combined_result}
        
        db_node.last_check = datetime.utcnow()
        db.commit()
        
        return {
            "node": db_node,
            "test_result": test_result,
            "message": f"Node created and tested ({test_type})"
        }
        
    except Exception as e:
        # Fallback to offline if test fails
        db_node.status = "offline"
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
        db.commit()
        
        if test_type == "ping":
            result = await network_tester.ping_test(node.ip)
            node.status = "online" if result['reachable'] else "offline"
        elif test_type == "speed":
            service_status = await service_manager.get_service_status(node_id)
            interface = service_status.get('interface') if service_status['active'] else None
            result = await network_tester.speed_test(interface)
            node.status = "online" if result['success'] else "degraded"
        else:  # both
            service_status = await service_manager.get_service_status(node_id)
            interface = service_status.get('interface') if service_status['active'] else None
            result = await network_tester.combined_test(node.ip, interface, "both")
            node.status = result['overall']
        
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
            db.commit()
        
        return {
            "success": result['success'],
            "node_id": node_id,
            "message": result['message']
        }
        
    except Exception as e:
        return {"success": False, "message": str(e)}

# Include API router
app.include_router(api_router)

# Health check
@app.get("/health")
async def health_check():
    return {"status": "ok", "timestamp": datetime.utcnow()}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
