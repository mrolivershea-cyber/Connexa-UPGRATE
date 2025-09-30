from sqlalchemy import create_engine, Column, Integer, String, DateTime, Boolean, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.sql import func
import os
from dotenv import load_dotenv
from passlib.context import CryptContext
import hashlib

load_dotenv()

# Database configuration
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./connexa.db")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# User model
class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    password = Column(String(255), nullable=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

# Node model
class Node(Base):
    __tablename__ = "nodes"
    
    id = Column(Integer, primary_key=True, index=True)
    ip = Column(String(45), index=True, nullable=False)
    port = Column(Integer, nullable=True)  # Port for the service
    login = Column(String(100), default="")
    password = Column(String(255), default="")
    provider = Column(String(100), default="")
    country = Column(String(100), default="")
    state = Column(String(100), default="")
    city = Column(String(100), default="")
    zipcode = Column(String(20), default="")
    comment = Column(Text, default="")
    protocol = Column(String(10), default="pptp")  # pptp, ssh, socks, server
    status = Column(String(20), default="not_tested")  # Unified status: not_tested, ping_failed, ping_ok, speed_slow, speed_ok, offline, online
    speed = Column(String(20), nullable=True)  # Connection speed in Mbps
    last_check = Column(DateTime, nullable=True)
    last_update = Column(DateTime, server_default=func.now(), onupdate=func.now())
    created_at = Column(DateTime, server_default=func.now())

def create_tables():
    Base.metadata.create_all(bind=engine)

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)
