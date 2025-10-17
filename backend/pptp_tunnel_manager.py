"""
PPTP Tunnel Manager for SOCKS5 Proxy
Manages PPTP connections and routing for each node
"""
import subprocess
import os
import time
import logging
from typing import Dict, Optional, Tuple
import re

logger = logging.getLogger("pptp_tunnel")

class PPTPTunnelManager:
    """Manages PPTP tunnels for SOCKS5 proxies"""
    
    def __init__(self):
        self.active_tunnels: Dict[int, Dict] = {}  # node_id -> tunnel_info
        
    def create_tunnel(self, node_id: int, node_ip: str, username: str, password: str) -> Optional[Dict]:
        """
        Create PPTP tunnel to node
        Returns: {
            'interface': 'ppp0',
            'local_ip': '10.0.0.1',
            'remote_ip': '10.0.0.2',
            'pid': 1234
        }
        """
        try:
            logger.info(f"🔧 Creating PPTP tunnel to {node_ip} for node {node_id}")
            
            # Create unique config for this tunnel  
            config_name = f"pptp_node_{node_id}"
            peer_file = f"/etc/ppp/peers/{config_name}"
            os.makedirs("/etc/ppp/peers", exist_ok=True)
            
            with open(peer_file, 'w') as f:
                f.write(f"""pty "pptp {node_ip} --nolaunchpppd"
name {username}
password {password}
remotename PPTP
require-mppe-128
file /etc/ppp/options.pptp
ipparam node_{node_id}
nodefaultroute
""")
            
            # Start PPTP connection
            cmd = f"pppd call {config_name} updetach logfile /tmp/pptp_node_{node_id}.log"
            
            logger.info(f"📞 Starting PPTP: {cmd}")
            
            # Start pppd process
            process = subprocess.Popen(
                cmd.split(),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            
            # Wait for connection to establish (max 15 seconds)
            max_wait = 15
            interface = None
            local_ip = None
            remote_ip = None
            
            for i in range(max_wait):
                time.sleep(1)
                
                # Check if process is still running
                if process.poll() is not None:
                    stderr = process.stderr.read().decode()
                    logger.error(f"❌ PPTP process died: {stderr}")
                    return None
                
                # Try to find the interface
                result = subprocess.run(
                    "ifconfig | grep -E 'ppp[0-9]+'",
                    shell=True,
                    capture_output=True,
                    text=True
                )
                
                if result.stdout:
                    # Extract interface name
                    match = re.search(r'(ppp\d+):', result.stdout)
                    if match:
                        interface = match.group(1)
                        
                        # Get IP addresses
                        ip_result = subprocess.run(
                            f"ifconfig {interface}",
                            shell=True,
                            capture_output=True,
                            text=True
                        )
                        
                        # Extract local IP
                        local_match = re.search(r'inet\s+(\d+\.\d+\.\d+\.\d+)', ip_result.stdout)
                        if local_match:
                            local_ip = local_match.group(1)
                        
                        # Extract remote IP
                        remote_match = re.search(r'destination\s+(\d+\.\d+\.\d+\.\d+)', ip_result.stdout)
                        if remote_match:
                            remote_ip = remote_match.group(1)
                        
                        if local_ip and remote_ip:
                            logger.info(f"✅ PPTP tunnel established: {interface} ({local_ip} -> {remote_ip})")
                            
                            tunnel_info = {
                                'interface': interface,
                                'local_ip': local_ip,
                                'remote_ip': remote_ip,
                                'pid': process.pid,
                                'node_ip': node_ip,
                                'node_id': node_id
                            }
                            
                            self.active_tunnels[node_id] = tunnel_info
                            return tunnel_info
            
            # Timeout
            logger.error(f"❌ PPTP tunnel timeout for node {node_id}")
            process.kill()
            return None
            
        except Exception as e:
            logger.error(f"❌ Error creating PPTP tunnel for node {node_id}: {e}")
            return None
    
    def destroy_tunnel(self, node_id: int) -> bool:
        """Destroy PPTP tunnel for node"""
        try:
            if node_id not in self.active_tunnels:
                logger.warning(f"⚠️ No active tunnel for node {node_id}")
                return True
            
            tunnel_info = self.active_tunnels[node_id]
            interface = tunnel_info['interface']
            pid = tunnel_info['pid']
            
            logger.info(f"🛑 Destroying PPTP tunnel {interface} for node {node_id}")
            
            # Kill pppd process
            try:
                subprocess.run(f"kill {pid}", shell=True, timeout=5)
                time.sleep(1)
                subprocess.run(f"kill -9 {pid}", shell=True, timeout=5)
            except Exception:
                pass
            
            # Remove interface if still exists
            try:
                subprocess.run(f"ip link delete {interface}", shell=True, timeout=5)
            except Exception:
                pass
            
            # Cleanup config
            peer_file = f"/etc/ppp/peers/pptp_node_{node_id}"
            try:
                if os.path.exists(peer_file):
                    os.remove(peer_file)
            except Exception:
                pass
            
            del self.active_tunnels[node_id]
            logger.info(f"✅ PPTP tunnel destroyed for node {node_id}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Error destroying PPTP tunnel for node {node_id}: {e}")
            return False
    
    def get_tunnel_info(self, node_id: int) -> Optional[Dict]:
        """Get tunnel info for node"""
        return self.active_tunnels.get(node_id)
    
    def is_tunnel_active(self, node_id: int) -> bool:
        """Check if tunnel is active"""
        if node_id not in self.active_tunnels:
            return False
        
        tunnel_info = self.active_tunnels[node_id]
        interface = tunnel_info['interface']
        
        # Check if interface exists
        result = subprocess.run(
            f"ifconfig {interface}",
            shell=True,
            capture_output=True,
            text=True
        )
        
        return result.returncode == 0

# Global instance
pptp_tunnel_manager = PPTPTunnelManager()
