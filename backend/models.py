from pydantic import BaseModel
from typing import Optional
from enum import Enum


class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class EmailSettings(BaseModel):
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None
    daily_report: int = 0
    report_time: str = "18:00"
    recipient: Optional[str] = None


class GoogleTaskCreate(BaseModel):
    title: str
    notes: Optional[str] = None
    due: Optional[str] = None


class GoogleTaskUpdate(BaseModel):
    completed: bool


class GoogleCalendarEventCreate(BaseModel):
    title: str
    start: str
    end: str
    description: Optional[str] = None


class PriorityEnum(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


# Spending Models
class SpendingCreate(BaseModel):
    amount: float
    category: str
    description: Optional[str] = None
    date: str


class SpendingUpdate(BaseModel):
    amount: Optional[float] = None
    category: Optional[str] = None
    description: Optional[str] = None
    date: Optional[str] = None


class SpendingResponse(BaseModel):
    id: int
    amount: float
    category: str
    description: Optional[str]
    date: str
    created_at: str

    class Config:
        from_attributes = True


# Todo Models
class TodoCreate(BaseModel):
    title: str
    description: Optional[str] = None
    priority: PriorityEnum = PriorityEnum.medium
    due_date: Optional[str] = None


class TodoUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    completed: Optional[bool] = None
    priority: Optional[PriorityEnum] = None
    due_date: Optional[str] = None


class TodoResponse(BaseModel):
    id: int
    title: str
    description: Optional[str]
    completed: bool
    priority: str
    due_date: Optional[str]
    created_at: str

    class Config:
        from_attributes = True


# Work Log Models
class WorkLogCreate(BaseModel):
    task: str
    project: Optional[str] = None
    hours: float
    date: str
    notes: Optional[str] = None


class WorkLogUpdate(BaseModel):
    task: Optional[str] = None
    project: Optional[str] = None
    hours: Optional[float] = None
    date: Optional[str] = None
    notes: Optional[str] = None


class WorkLogResponse(BaseModel):
    id: int
    task: str
    project: Optional[str]
    hours: float
    date: str
    notes: Optional[str]
    created_at: str

    class Config:
        from_attributes = True


# Schedule Models
class ScheduleCreate(BaseModel):
    title: str
    start_time: str
    end_time: str
    date: str
    recurring: bool = False
    notes: Optional[str] = None


class ScheduleUpdate(BaseModel):
    title: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    date: Optional[str] = None
    recurring: Optional[bool] = None
    notes: Optional[str] = None


class ScheduleResponse(BaseModel):
    id: int
    title: str
    start_time: str
    end_time: str
    date: str
    recurring: bool
    notes: Optional[str]
    created_at: str

    class Config:
        from_attributes = True
