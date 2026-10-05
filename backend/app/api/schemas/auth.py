"""Pydantic request and response models for authentication endpoints."""

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    create_admin: bool = False
    admin_verification_password: str | None = Field(default=None, max_length=256)


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=320)
    password: str = Field(min_length=1, max_length=128)


class PasswordRecoveryRequest(BaseModel):
    identifier: str = Field(min_length=1, max_length=320)


class PasswordRecoveryOtpRequest(BaseModel):
    identifier: str = Field(min_length=1, max_length=320)
    otp: str = Field(min_length=6, max_length=6, pattern=r"^\\d{6}$")


class PasswordResetRequest(BaseModel):
    token: str = Field(min_length=20, max_length=512)
    new_password: str = Field(min_length=8, max_length=128)


class RecoveryDispatchResponse(BaseModel):
    detail: str
    expires_in: int


class MessageResponse(BaseModel):
    detail: str


class UserResponse(BaseModel):
    id: str
    username: str
    email: str
    display_name: str
    role: str
    account_type: str
    avatar_url: str | None = None


class AuthResponse(BaseModel):
    access_token: str
    token_type: str
    expires_in: int
    user: UserResponse
