"""SOCKS5 Server with PPTP routing via SO_BINDTODEVICE"""
import socket
import struct
import logging
import secrets
import time
import select
from typing import Optional, Tuple
from threading import Thread, Lock

logger = logging.getLogger("socks_server")

class SOCKSProxy:
    def __init__(self):
        self.running_servers = {}
        self.stats_lock = Lock()
        
    def start_socks_for_node(self, node_id: int, node_ip: str, port: int, ppp_interface: str,
                           username: str, password: str, masking_config: dict) -> bool:
        try:
            if node_id in self.running_servers:
                logger.warning(f"SOCKS already running for node {node_id}")
                return True
                
            server = SOCKSServer(
                node_id=node_id,
                node_ip=node_ip,
                port=port,
                ppp_interface=ppp_interface,
                username=username,
                password=password
            )
            
            if server.start():
                self.running_servers[node_id] = server
                logger.info(f"✅ SOCKS5 server started for node {node_id} on port {port}")
                return True
            else:
                logger.error(f"❌ Failed to start SOCKS5 for node {node_id}")
                return False
        except Exception as e:
            logger.error(f"Error starting SOCKS for node {node_id}: {e}")
            return False
    
    def stop_socks_for_node(self, node_id: int) -> bool:
        try:
            if node_id not in self.running_servers:
                logger.warning(f"No SOCKS running for node {node_id}")
                return True
            server = self.running_servers[node_id]
            server.stop()
            del self.running_servers[node_id]
            logger.info(f"🛑 SOCKS5 stopped for node {node_id}")
            return True
        except Exception as e:
            logger.error(f"Error stopping SOCKS for node {node_id}: {e}")
            return False
    
    def get_stats(self) -> dict:
        return {
            'online_socks': len(self.running_servers),
            'total_tunnels': len(self.running_servers)
        }

class SOCKSServer:
    def __init__(self, node_id: int, node_ip: str, port: int, ppp_interface: str,
                 username: str, password: str):
        self.node_id = node_id
        self.node_ip = node_ip
        self.port = port
        self.ppp_interface = ppp_interface
        self.username = username
        self.password = password
        self.server_socket = None
        self.running = False
        self.server_thread = None
        
    def start(self) -> bool:
        try:
            self.server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            self.server_socket.bind(('0.0.0.0', self.port))
            self.server_socket.listen(100)
            self.running = True
            self.server_thread = Thread(target=self._server_loop, daemon=True)
            self.server_thread.start()
            logger.info(f"SOCKS5 server started on port {self.port} for node {self.node_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to start SOCKS5 on port {self.port}: {e}")
            return False
    
    def stop(self):
        self.running = False
        if self.server_socket:
            self.server_socket.close()
    
    def _server_loop(self):
        while self.running:
            try:
                client_socket, addr = self.server_socket.accept()
                Thread(target=self._handle_client, args=(client_socket, addr), daemon=True).start()
            except Exception as e:
                if self.running:
                    logger.error(f"Error accepting connection on port {self.port}: {e}")
                break
    
    def _handle_client(self, client_socket: socket.socket, addr: Tuple):
        try:
            if not self._socks5_handshake(client_socket):
                return
            if not self._socks5_auth(client_socket):
                return
            target_host, target_port = self._socks5_request(client_socket)
            if not target_host:
                return
            upstream = self._connect_through_ppp(target_host, target_port)
            if not upstream:
                return
            self._relay_data(client_socket, upstream)
        except Exception as e:
            logger.debug(f"Client handler error: {e}")
        finally:
            try:
                client_socket.close()
            except:
                pass
    
    def _socks5_handshake(self, client: socket.socket) -> bool:
        try:
            data = client.recv(2)
            if len(data) < 2 or data[0] != 5:
                return False
            nmethods = data[1]
            methods = client.recv(nmethods)
            client.send(b'\x05\x02')
            return True
        except:
            return False
    
    def _socks5_auth(self, client: socket.socket) -> bool:
        try:
            data = client.recv(2)
            if len(data) < 2:
                return False
            ulen = data[1]
            username = client.recv(ulen).decode()
            plen_data = client.recv(1)
            if not plen_data:
                return False
            plen = plen_data[0]
            password = client.recv(plen).decode()
            if username == self.username and password == self.password:
                client.send(b'\x01\x00')
                return True
            else:
                client.send(b'\x01\x01')
                return False
        except:
            return False
    
    def _socks5_request(self, client: socket.socket) -> Tuple[Optional[str], Optional[int]]:
        try:
            data = client.recv(4)
            if len(data) < 4 or data[0] != 5 or data[1] != 1:
                return None, None
            atyp = data[3]
            if atyp == 1:
                addr_data = client.recv(4)
                target_host = '.'.join(str(b) for b in addr_data)
            elif atyp == 3:
                addr_len = client.recv(1)[0]
                target_host = client.recv(addr_len).decode()
            else:
                return None, None
            port_data = client.recv(2)
            target_port = struct.unpack('>H', port_data)[0]
            client.send(b'\x05\x00\x00\x01' + b'\x00'*4 + b'\x00'*2)
            return target_host, target_port
        except Exception as e:
            logger.error(f"SOCKS5 request error: {e}")
            return None, None
    
    def _connect_through_ppp(self, target_host: str, target_port: int) -> Optional[socket.socket]:
        try:
            upstream = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            upstream.settimeout(30)
            
            # SO_BINDTODEVICE - привязка к ppp интерфейсу
            if self.ppp_interface:
                try:
                    SO_BINDTODEVICE = 25
                    upstream.setsockopt(socket.SOL_SOCKET, SO_BINDTODEVICE, self.ppp_interface.encode())
                    logger.debug(f"✅ Socket привязан к {self.ppp_interface}")
                except Exception as e:
                    logger.warning(f"⚠️ Не удалось привязать к {self.ppp_interface}: {e}")
            
            upstream.connect((target_host, target_port))
            logger.debug(f"Connected to {target_host}:{target_port} via {self.ppp_interface}")
            return upstream
        except Exception as e:
            logger.error(f"Failed to connect to {target_host}:{target_port}: {e}")
            return None
    
    def _relay_data(self, client: socket.socket, upstream: socket.socket):
        try:
            sockets = [client, upstream]
            while True:
                ready, _, _ = select.select(sockets, [], [], 30)
                if not ready:
                    break
                for sock in ready:
                    try:
                        data = sock.recv(4096)
                        if not data:
                            return
                        other = upstream if sock == client else client
                        other.send(data)
                    except:
                        return
        except:
            pass
        finally:
            try:
                upstream.close()
            except:
                pass

socks_proxy = SOCKSProxy()

def start_socks_service(node_id: int, node_ip: str, port: int, username: str, 
                       password: str, ppp_interface: str = None, masking_config: dict = None) -> bool:
    return socks_proxy.start_socks_for_node(
        node_id=node_id,
        node_ip=node_ip,
        port=port,
        ppp_interface=ppp_interface or '',
        username=username,
        password=password,
        masking_config=masking_config or {}
    )

def stop_socks_service(node_id: int) -> bool:
    return socks_proxy.stop_socks_for_node(node_id)

def get_socks_stats() -> dict:
    return socks_proxy.get_stats()
