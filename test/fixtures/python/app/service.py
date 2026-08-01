"""User service — core business logic."""

from typing import Optional


class User:
    """User domain model."""
    id: str = ""
    email: str = ""
    name: str = ""


class UserService:
    """Handles user creation and lookup.

    Should be detected as SERVICE (naming convention).
    """

    def __init__(self, user_repository, mailer):
        self.user_repository = user_repository
        self.mailer = mailer

    async def find_by_id(self, user_id: str) -> Optional[User]:
        """Find a user by their ID."""
        user = await self.user_repository.find_one(user_id)
        if not user:
            raise ValueError(f"User {user_id} not found")
        return user

    async def create_user(self, email: str, name: str) -> User:
        """Create a user and send welcome email."""
        user = User()
        user.email = email
        user.name = name
        await self.user_repository.save(user)
        await self.mailer.send_welcome(user)
        return user
