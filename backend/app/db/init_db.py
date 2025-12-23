from app.db.session import engine, Base, SessionLocal
from app.models import models  # noqa: F401
from app.core.config import settings
from app.core.security import hash_password
from app.models.models import User


def init_db():
    Base.metadata.create_all(bind=engine)

    # bootstrap admin if none exists
    db = SessionLocal()
    try:
        exists = db.query(User).filter(User.email == settings.bootstrap_admin_email).first()
        if not exists:
            u = User(
                email=settings.bootstrap_admin_email,
                name="Admin",
                password_hash=hash_password(settings.bootstrap_admin_password),
                role="admin",
                is_active=True,
            )
            db.add(u)
            db.commit()
    finally:
        db.close()
