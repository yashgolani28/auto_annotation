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
        email = (settings.bootstrap_admin_email or "").strip().lower()
        if not email:
            return

        u = db.query(User).filter(User.email == email).first()
        if not u:
            u = User(
                email=email,
                name="Admin",
                password_hash=hash_password(settings.bootstrap_admin_password),
                role="admin",
                is_active=True,
            )
            db.add(u)
            db.commit()
            return

        # If the user exists already but isn't admin, promote it.
        changed = False
        if u.role != "admin":
            u.role = "admin"
            changed = True
        if not u.is_active:
            u.is_active = True
            changed = True

        # NOTE: We do NOT overwrite password if user already exists.
        if changed:
            db.add(u)
            db.commit()
    finally:
        db.close()
