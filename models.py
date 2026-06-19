"""
Shoply - Database Models
SQLite database via SQLAlchemy. Single-file DB, photos stored as BLOBs.
"""
from datetime import datetime, date
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class Shop(db.Model):
    __tablename__ = "shops"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False, unique=True)
    location = db.Column(db.String(200))
    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    items = db.relationship("Item", backref="shop", lazy=True, cascade="all, delete-orphan")
    trips = db.relationship("Trip", backref="shop", lazy=True)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "location": self.location,
            "notes": self.notes,
            "item_count": len(self.items),
        }


class Category(db.Model):
    __tablename__ = "categories"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), nullable=False, unique=True)

    items = db.relationship("Item", backref="category", lazy=True)

    def to_dict(self):
        return {"id": self.id, "name": self.name}


class Item(db.Model):
    """
    A remembered item at a specific shop, with its most recent unit price
    and optional photo. Populates the quick-pick list when a shop is selected.
    """
    __tablename__ = "items"

    id = db.Column(db.Integer, primary_key=True)
    shop_id = db.Column(db.Integer, db.ForeignKey("shops.id"), nullable=False)
    category_id = db.Column(db.Integer, db.ForeignKey("categories.id"), nullable=True)

    name = db.Column(db.String(150), nullable=False)
    unit_price = db.Column(db.Float, nullable=False)
    unit_label = db.Column(db.String(30), default="each")

    photo = db.Column(db.LargeBinary, nullable=True)
    photo_mimetype = db.Column(db.String(50), nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    price_history = db.relationship(
        "PriceHistory", backref="item", lazy=True,
        cascade="all, delete-orphan", order_by="PriceHistory.recorded_at.desc()"
    )

    def to_dict(self, include_photo_flag=True):
        return {
            "id": self.id,
            "shop_id": self.shop_id,
            "category_id": self.category_id,
            "category_name": self.category.name if self.category else None,
            "name": self.name,
            "unit_price": self.unit_price,
            "unit_label": self.unit_label,
            "has_photo": bool(self.photo) if include_photo_flag else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class PriceHistory(db.Model):
    """Tracks how an item's price has changed over time at a given shop."""
    __tablename__ = "price_history"

    id = db.Column(db.Integer, primary_key=True)
    item_id = db.Column(db.Integer, db.ForeignKey("items.id"), nullable=False)
    unit_price = db.Column(db.Float, nullable=False)
    recorded_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "unit_price": self.unit_price,
            "recorded_at": self.recorded_at.isoformat(),
        }


class Trip(db.Model):
    """A completed/saved shopping trip with its line items and total."""
    __tablename__ = "trips"

    id = db.Column(db.Integer, primary_key=True)
    shop_id = db.Column(db.Integer, db.ForeignKey("shops.id"), nullable=True)
    trip_date = db.Column(db.Date, default=date.today)
    budget_limit = db.Column(db.Float, nullable=True)
    tax_applied = db.Column(db.Boolean, default=False)
    tax_rate = db.Column(db.Float, default=10.0)
    notes = db.Column(db.Text)
    receipt_photo = db.Column(db.LargeBinary, nullable=True)
    receipt_photo_mimetype = db.Column(db.String(50), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    lines = db.relationship(
        "TripLine", backref="trip", lazy=True, cascade="all, delete-orphan"
    )

    @property
    def subtotal(self):
        return sum(line.line_total for line in self.lines)

    @property
    def tax_amount(self):
        return round(self.subtotal * (self.tax_rate / 100.0), 2) if self.tax_applied else 0.0

    @property
    def grand_total(self):
        return round(self.subtotal + self.tax_amount, 2)

    def to_dict(self):
        return {
            "id": self.id,
            "shop_id": self.shop_id,
            "shop_name": self.shop.name if self.shop else "No shop selected",
            "trip_date": self.trip_date.isoformat() if self.trip_date else None,
            "budget_limit": self.budget_limit,
            "tax_applied": self.tax_applied,
            "tax_rate": self.tax_rate,
            "subtotal": self.subtotal,
            "tax_amount": self.tax_amount,
            "grand_total": self.grand_total,
            "notes": self.notes,
            "has_receipt": bool(self.receipt_photo),
            "lines": [line.to_dict() for line in self.lines],
        }


class TripLine(db.Model):
    """A single line item within a shopping trip."""
    __tablename__ = "trip_lines"

    id = db.Column(db.Integer, primary_key=True)
    trip_id = db.Column(db.Integer, db.ForeignKey("trips.id"), nullable=False)
    item_name = db.Column(db.String(150), nullable=False)
    unit_price = db.Column(db.Float, nullable=False)
    quantity = db.Column(db.Float, nullable=False, default=1.0)
    unit_label = db.Column(db.String(30), default="each")

    @property
    def line_total(self):
        return round(self.unit_price * self.quantity, 2)

    def to_dict(self):
        return {
            "id": self.id,
            "item_name": self.item_name,
            "unit_price": self.unit_price,
            "quantity": self.quantity,
            "unit_label": self.unit_label,
            "line_total": self.line_total,
        }


class OtherCost(db.Model):
    """
    Non-grocery costs: gardener, babysitter, debts owed/owed-to-you, utilities, etc.
    """
    __tablename__ = "other_costs"

    id = db.Column(db.Integer, primary_key=True)
    payee = db.Column(db.String(150), nullable=False)
    category = db.Column(db.String(80), nullable=False, default="General")
    amount = db.Column(db.Float, nullable=False)
    direction = db.Column(db.String(10), nullable=False, default="owed_by_me")
    status = db.Column(db.String(10), nullable=False, default="pending")
    due_date = db.Column(db.Date, nullable=True)
    paid_date = db.Column(db.Date, nullable=True)
    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "payee": self.payee,
            "category": self.category,
            "amount": self.amount,
            "direction": self.direction,
            "status": self.status,
            "due_date": self.due_date.isoformat() if self.due_date else None,
            "paid_date": self.paid_date.isoformat() if self.paid_date else None,
            "notes": self.notes,
        }


class ShoppingListItem(db.Model):
    """A pre-trip shopping list item — planned before leaving home."""
    __tablename__ = "shopping_list"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(150), nullable=False)
    quantity = db.Column(db.Float, default=1.0)
    unit_label = db.Column(db.String(30), default="each")
    note = db.Column(db.String(200))
    checked = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "quantity": self.quantity,
            "unit_label": self.unit_label,
            "note": self.note or "",
            "checked": self.checked,
        }


class PantryItem(db.Model):
    """Tracks what's in stock at home; flags items that fall below a threshold."""
    __tablename__ = "pantry"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(150), nullable=False)
    quantity = db.Column(db.Float, default=0.0)
    unit_label = db.Column(db.String(30), default="each")
    low_threshold = db.Column(db.Float, default=1.0)
    notes = db.Column(db.String(200))
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "quantity": self.quantity,
            "unit_label": self.unit_label,
            "low_threshold": self.low_threshold,
            "notes": self.notes or "",
            "is_low": self.quantity <= self.low_threshold,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
