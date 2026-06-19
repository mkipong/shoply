"""
Shoply - Main Flask Application
A grocery price calculator and household cost tracker for use while shopping.
Currency: Papua New Guinea Kina (K), hardcoded throughout.
"""
import os
import base64
from datetime import datetime, date
from io import BytesIO

from flask import Flask, render_template, request, jsonify, send_file, abort
from sqlalchemy import func, text

from models import (
    db, Shop, Category, Item, PriceHistory,
    Trip, TripLine, OtherCost, ShoppingListItem, PantryItem,
)

BASE_DIR = os.path.abspath(os.path.dirname(__file__))

app = Flask(__name__)
_db_path = os.environ.get("DATABASE_PATH", os.path.join("/tmp", "shoply.db"))
os.makedirs(os.path.dirname(os.path.abspath(_db_path)), exist_ok=True)
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///" + _db_path
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024  # 8 MB

db.init_app(app)

DEFAULT_CATEGORIES = ["Groceries", "Hardware", "Fuel", "Household", "Stationery", "Other"]


def seed_defaults():
    if Category.query.count() == 0:
        for name in DEFAULT_CATEGORIES:
            db.session.add(Category(name=name))
        db.session.commit()


with app.app_context():
    db.create_all()
    # Safe migration: add new Trip columns if the DB predates them
    with db.engine.connect() as conn:
        for stmt in [
            "ALTER TABLE trips ADD COLUMN receipt_photo BLOB",
            "ALTER TABLE trips ADD COLUMN receipt_photo_mimetype VARCHAR(50)",
        ]:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass  # column already exists
    seed_defaults()


# ---------------------------------------------------------------------------
# PWA
# ---------------------------------------------------------------------------

@app.route("/sw.js")
def service_worker():
    return app.send_static_file("sw.js"), 200, {"Content-Type": "application/javascript; charset=utf-8"}


# ---------------------------------------------------------------------------
# Page routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


# ---------------------------------------------------------------------------
# Shops
# ---------------------------------------------------------------------------

@app.route("/api/shops", methods=["GET"])
def get_shops():
    shops = Shop.query.order_by(Shop.name.asc()).all()
    return jsonify([s.to_dict() for s in shops])


@app.route("/api/shops", methods=["POST"])
def create_shop():
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Shop name is required."}), 400

    existing = Shop.query.filter(func.lower(Shop.name) == name.lower()).first()
    if existing:
        return jsonify({"error": "A shop with that name already exists."}), 409

    shop = Shop(name=name, location=data.get("location", "").strip(), notes=data.get("notes", "").strip())
    db.session.add(shop)
    db.session.commit()
    return jsonify(shop.to_dict()), 201


@app.route("/api/shops/<int:shop_id>", methods=["PUT"])
def update_shop(shop_id):
    shop = Shop.query.get_or_404(shop_id)
    data = request.get_json(force=True)

    new_name = (data.get("name") or "").strip()
    if new_name:
        dupe = Shop.query.filter(
            func.lower(Shop.name) == new_name.lower(), Shop.id != shop_id
        ).first()
        if dupe:
            return jsonify({"error": "Another shop already has that name."}), 409
        shop.name = new_name

    if "location" in data:
        shop.location = data.get("location", "").strip()
    if "notes" in data:
        shop.notes = data.get("notes", "").strip()

    db.session.commit()
    return jsonify(shop.to_dict())


@app.route("/api/shops/<int:shop_id>", methods=["DELETE"])
def delete_shop(shop_id):
    shop = Shop.query.get_or_404(shop_id)
    db.session.delete(shop)
    db.session.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------

@app.route("/api/categories", methods=["GET"])
def get_categories():
    cats = Category.query.order_by(Category.name.asc()).all()
    return jsonify([c.to_dict() for c in cats])


@app.route("/api/categories", methods=["POST"])
def create_category():
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Category name is required."}), 400
    if Category.query.filter(func.lower(Category.name) == name.lower()).first():
        return jsonify({"error": "That category already exists."}), 409
    cat = Category(name=name)
    db.session.add(cat)
    db.session.commit()
    return jsonify(cat.to_dict()), 201


@app.route("/api/categories/<int:cat_id>", methods=["DELETE"])
def delete_category(cat_id):
    cat = Category.query.get_or_404(cat_id)
    db.session.delete(cat)
    db.session.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Items
# ---------------------------------------------------------------------------

@app.route("/api/shops/<int:shop_id>/items", methods=["GET"])
def get_shop_items(shop_id):
    Shop.query.get_or_404(shop_id)
    search = request.args.get("q", "").strip()
    query = Item.query.filter_by(shop_id=shop_id)
    if search:
        query = query.filter(Item.name.ilike(f"%{search}%"))
    items = query.order_by(Item.name.asc()).all()
    return jsonify([i.to_dict() for i in items])


@app.route("/api/items/search", methods=["GET"])
def search_all_items():
    search = request.args.get("q", "").strip()
    if not search:
        return jsonify([])
    items = Item.query.filter(Item.name.ilike(f"%{search}%")).order_by(Item.updated_at.desc()).limit(50).all()
    results = []
    for i in items:
        d = i.to_dict()
        d["shop_name"] = i.shop.name
        results.append(d)
    return jsonify(results)


@app.route("/api/all-items", methods=["GET"])
def get_all_items():
    search = request.args.get("q", "").strip()
    query = Item.query
    if search:
        query = query.filter(Item.name.ilike(f"%{search}%"))
    items = query.order_by(Item.name.asc()).all()
    results = []
    for i in items:
        d = i.to_dict()
        d["shop_name"] = i.shop.name
        results.append(d)
    return jsonify(results)


@app.route("/api/compare", methods=["GET"])
def compare_item_prices():
    """Return the last recorded price for a named item at every shop that carries it."""
    name = request.args.get("q", "").strip()
    if not name:
        return jsonify([])
    items = Item.query.filter(Item.name.ilike(f"%{name}%")).order_by(Item.unit_price.asc()).all()
    results = []
    for i in items:
        d = i.to_dict()
        d["shop_name"] = i.shop.name
        d["shop_location"] = i.shop.location or ""
        results.append(d)
    return jsonify(results)


@app.route("/api/items", methods=["POST"])
def create_or_update_item():
    if request.content_type and "multipart/form-data" in request.content_type:
        form = request.form
        shop_id = form.get("shop_id", type=int)
        name = (form.get("name") or "").strip()
        unit_price = form.get("unit_price", type=float)
        unit_label = form.get("unit_label", "each").strip() or "each"
        category_id = form.get("category_id", type=int) or None
        photo_file = request.files.get("photo")
    else:
        data = request.get_json(force=True)
        shop_id = data.get("shop_id")
        name = (data.get("name") or "").strip()
        unit_price = data.get("unit_price")
        unit_label = (data.get("unit_label") or "each").strip()
        category_id = data.get("category_id") or None
        photo_file = None

    if not shop_id or not name or unit_price is None:
        return jsonify({"error": "shop_id, name, and unit_price are required."}), 400

    Shop.query.get_or_404(shop_id)

    item = Item.query.filter(
        Item.shop_id == shop_id, func.lower(Item.name) == name.lower()
    ).first()

    price_changed = False
    if item:
        if abs(item.unit_price - float(unit_price)) > 1e-9:
            price_changed = True
        item.unit_price = float(unit_price)
        item.unit_label = unit_label
        if category_id:
            item.category_id = category_id
    else:
        item = Item(
            shop_id=shop_id, name=name, unit_price=float(unit_price),
            unit_label=unit_label, category_id=category_id,
        )
        db.session.add(item)
        price_changed = True

    if photo_file and photo_file.filename:
        item.photo = photo_file.read()
        item.photo_mimetype = photo_file.mimetype

    db.session.flush()

    if price_changed:
        db.session.add(PriceHistory(item_id=item.id, unit_price=item.unit_price))

    db.session.commit()
    return jsonify(item.to_dict()), 201


@app.route("/api/items/<int:item_id>", methods=["DELETE"])
def delete_item(item_id):
    item = Item.query.get_or_404(item_id)
    db.session.delete(item)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/items/<int:item_id>/photo", methods=["GET"])
def get_item_photo(item_id):
    item = Item.query.get_or_404(item_id)
    if not item.photo:
        abort(404)
    return send_file(BytesIO(item.photo), mimetype=item.photo_mimetype or "image/jpeg")


@app.route("/api/items/<int:item_id>/history", methods=["GET"])
def get_item_history(item_id):
    item = Item.query.get_or_404(item_id)
    return jsonify([h.to_dict() for h in item.price_history])


# ---------------------------------------------------------------------------
# Trips
# ---------------------------------------------------------------------------

@app.route("/api/trips", methods=["POST"])
def create_trip():
    data = request.get_json(force=True)
    shop_id = data.get("shop_id")
    lines = data.get("lines", [])

    if not lines:
        return jsonify({"error": "A trip needs at least one line item."}), 400

    trip = Trip(
        shop_id=shop_id,
        trip_date=date.today(),
        budget_limit=data.get("budget_limit"),
        tax_applied=bool(data.get("tax_applied", False)),
        tax_rate=float(data.get("tax_rate", 10.0)),
        notes=(data.get("notes") or "").strip(),
    )
    db.session.add(trip)
    db.session.flush()

    for line in lines:
        db.session.add(TripLine(
            trip_id=trip.id,
            item_name=line["item_name"],
            unit_price=float(line["unit_price"]),
            quantity=float(line["quantity"]),
            unit_label=line.get("unit_label", "each"),
        ))

    # Auto-fill pantry: add purchased quantities to existing items or create new ones
    pantry_updated = 0
    for line in lines:
        name = line["item_name"].strip()
        qty = float(line["quantity"])
        unit = line.get("unit_label", "each")
        existing = PantryItem.query.filter(
            func.lower(PantryItem.name) == name.lower()
        ).first()
        if existing:
            existing.quantity = round(existing.quantity + qty, 3)
            existing.updated_at = datetime.now()
        else:
            db.session.add(PantryItem(
                name=name,
                quantity=qty,
                unit_label=unit,
                low_threshold=1.0,
            ))
        pantry_updated += 1

    db.session.commit()
    result = trip.to_dict()
    result["pantry_updated"] = pantry_updated
    return jsonify(result), 201


@app.route("/api/trips", methods=["GET"])
def list_trips():
    limit = request.args.get("limit", 50, type=int)
    trips = Trip.query.order_by(Trip.created_at.desc()).limit(limit).all()
    return jsonify([t.to_dict() for t in trips])


@app.route("/api/trips/<int:trip_id>", methods=["GET"])
def get_trip(trip_id):
    trip = Trip.query.get_or_404(trip_id)
    return jsonify(trip.to_dict())


@app.route("/api/trips/<int:trip_id>", methods=["DELETE"])
def delete_trip(trip_id):
    trip = Trip.query.get_or_404(trip_id)
    db.session.delete(trip)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/trips/<int:trip_id>/receipt", methods=["POST"])
def upload_trip_receipt(trip_id):
    trip = Trip.query.get_or_404(trip_id)
    photo = request.files.get("photo")
    if not photo:
        return jsonify({"error": "No photo provided."}), 400
    trip.receipt_photo = photo.read()
    trip.receipt_photo_mimetype = photo.mimetype
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/trips/<int:trip_id>/receipt", methods=["GET"])
def get_trip_receipt(trip_id):
    trip = Trip.query.get_or_404(trip_id)
    if not trip.receipt_photo:
        abort(404)
    return send_file(BytesIO(trip.receipt_photo), mimetype=trip.receipt_photo_mimetype or "image/jpeg")


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------

@app.route("/api/analytics/spending", methods=["GET"])
def analytics_spending():
    trips = Trip.query.order_by(Trip.trip_date.asc()).all()

    by_month = {}
    by_shop = {}

    for t in trips:
        if t.trip_date:
            month = t.trip_date.strftime("%Y-%m")
            by_month[month] = round(by_month.get(month, 0) + t.grand_total, 2)
        shop_name = t.shop.name if t.shop else "No shop"
        by_shop[shop_name] = round(by_shop.get(shop_name, 0) + t.grand_total, 2)

    total_trips = len(trips)
    total_spent = round(sum(t.grand_total for t in trips), 2)
    avg_trip = round(total_spent / total_trips, 2) if total_trips else 0.0

    sorted_months = sorted(by_month.items())[-12:]
    top_shops = sorted(by_shop.items(), key=lambda x: x[1], reverse=True)[:8]

    return jsonify({
        "total_trips": total_trips,
        "total_spent": total_spent,
        "avg_trip": avg_trip,
        "by_month": [{"month": m, "total": v} for m, v in sorted_months],
        "by_shop": [{"shop": k, "total": v} for k, v in top_shops],
    })


# ---------------------------------------------------------------------------
# Shopping list
# ---------------------------------------------------------------------------

@app.route("/api/shopping-list", methods=["GET"])
def get_shopping_list():
    items = ShoppingListItem.query.order_by(
        ShoppingListItem.checked.asc(), ShoppingListItem.created_at.asc()
    ).all()
    return jsonify([i.to_dict() for i in items])


@app.route("/api/shopping-list", methods=["POST"])
def add_shopping_list_item():
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Name is required."}), 400
    item = ShoppingListItem(
        name=name,
        quantity=float(data.get("quantity", 1)),
        unit_label=(data.get("unit_label") or "each").strip(),
        note=(data.get("note") or "").strip(),
    )
    db.session.add(item)
    db.session.commit()
    return jsonify(item.to_dict()), 201


@app.route("/api/shopping-list/<int:item_id>", methods=["PUT"])
def update_shopping_list_item(item_id):
    item = ShoppingListItem.query.get_or_404(item_id)
    data = request.get_json(force=True)
    if "checked" in data:
        item.checked = bool(data["checked"])
    if "name" in data:
        item.name = (data["name"] or "").strip()
    if "quantity" in data:
        item.quantity = float(data["quantity"])
    if "note" in data:
        item.note = (data["note"] or "").strip()
    db.session.commit()
    return jsonify(item.to_dict())


@app.route("/api/shopping-list/<int:item_id>", methods=["DELETE"])
def delete_shopping_list_item(item_id):
    item = ShoppingListItem.query.get_or_404(item_id)
    db.session.delete(item)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/shopping-list/clear-checked", methods=["POST"])
def clear_checked_list_items():
    ShoppingListItem.query.filter_by(checked=True).delete()
    db.session.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Pantry
# ---------------------------------------------------------------------------

@app.route("/api/pantry", methods=["GET"])
def get_pantry():
    items = PantryItem.query.order_by(PantryItem.name.asc()).all()
    return jsonify([i.to_dict() for i in items])


@app.route("/api/pantry", methods=["POST"])
def add_pantry_item():
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Name is required."}), 400
    item = PantryItem(
        name=name,
        quantity=float(data.get("quantity", 1)),
        unit_label=(data.get("unit_label") or "each").strip(),
        low_threshold=float(data.get("low_threshold", 1)),
        notes=(data.get("notes") or "").strip(),
    )
    db.session.add(item)
    db.session.commit()
    return jsonify(item.to_dict()), 201


@app.route("/api/pantry/<int:item_id>", methods=["PUT"])
def update_pantry_item(item_id):
    item = PantryItem.query.get_or_404(item_id)
    data = request.get_json(force=True)
    for field in ["name", "unit_label", "notes"]:
        if field in data:
            setattr(item, field, (data[field] or "").strip())
    for field in ["quantity", "low_threshold"]:
        if field in data:
            setattr(item, field, float(data[field]))
    item.updated_at = datetime.now()
    db.session.commit()
    return jsonify(item.to_dict())


@app.route("/api/pantry/<int:item_id>", methods=["DELETE"])
def delete_pantry_item(item_id):
    item = PantryItem.query.get_or_404(item_id)
    db.session.delete(item)
    db.session.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Other Costs
# ---------------------------------------------------------------------------

@app.route("/api/other-costs", methods=["GET"])
def list_other_costs():
    status = request.args.get("status")
    direction = request.args.get("direction")
    query = OtherCost.query
    if status:
        query = query.filter_by(status=status)
    if direction:
        query = query.filter_by(direction=direction)
    costs = query.order_by(OtherCost.created_at.desc()).all()
    return jsonify([c.to_dict() for c in costs])


@app.route("/api/other-costs", methods=["POST"])
def create_other_cost():
    data = request.get_json(force=True)
    payee = (data.get("payee") or "").strip()
    amount = data.get("amount")

    if not payee or amount is None:
        return jsonify({"error": "payee and amount are required."}), 400

    due_date_str = data.get("due_date")
    cost = OtherCost(
        payee=payee,
        category=(data.get("category") or "General").strip(),
        amount=float(amount),
        direction=data.get("direction", "owed_by_me"),
        status=data.get("status", "pending"),
        due_date=datetime.strptime(due_date_str, "%Y-%m-%d").date() if due_date_str else None,
        notes=(data.get("notes") or "").strip(),
    )
    db.session.add(cost)
    db.session.commit()
    return jsonify(cost.to_dict()), 201


@app.route("/api/other-costs/<int:cost_id>", methods=["PUT"])
def update_other_cost(cost_id):
    cost = OtherCost.query.get_or_404(cost_id)
    data = request.get_json(force=True)

    for field in ["payee", "category", "direction", "status", "notes"]:
        if field in data:
            setattr(cost, field, (data[field] or "").strip() if isinstance(data[field], str) else data[field])

    if "amount" in data:
        cost.amount = float(data["amount"])

    if data.get("status") == "paid" and not cost.paid_date:
        cost.paid_date = date.today()
    elif data.get("status") == "pending":
        cost.paid_date = None

    if "due_date" in data:
        cost.due_date = datetime.strptime(data["due_date"], "%Y-%m-%d").date() if data["due_date"] else None

    db.session.commit()
    return jsonify(cost.to_dict())


@app.route("/api/other-costs/<int:cost_id>", methods=["DELETE"])
def delete_other_cost(cost_id):
    cost = OtherCost.query.get_or_404(cost_id)
    db.session.delete(cost)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/other-costs/summary", methods=["GET"])
def other_costs_summary():
    owed_by_me_pending = db.session.query(func.coalesce(func.sum(OtherCost.amount), 0)).filter_by(
        direction="owed_by_me", status="pending"
    ).scalar()
    owed_to_me_pending = db.session.query(func.coalesce(func.sum(OtherCost.amount), 0)).filter_by(
        direction="owed_to_me", status="pending"
    ).scalar()
    paid_total = db.session.query(func.coalesce(func.sum(OtherCost.amount), 0)).filter_by(
        direction="owed_by_me", status="paid"
    ).scalar()
    overdue_count = OtherCost.query.filter(
        OtherCost.status == "pending",
        OtherCost.due_date != None,
        OtherCost.due_date < date.today(),
    ).count()
    return jsonify({
        "owed_by_me_pending": round(owed_by_me_pending, 2),
        "owed_to_me_pending": round(owed_to_me_pending, 2),
        "paid_total": round(paid_total, 2),
        "overdue_count": overdue_count,
    })


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

@app.route("/api/export/items.csv")
def export_items_csv():
    output = BytesIO()
    text_buf = ["shop,item,unit_price,unit_label,category,last_updated\n"]
    items = Item.query.order_by(Item.shop_id.asc(), Item.name.asc()).all()
    for i in items:
        row = [
            i.shop.name, i.name, f"{i.unit_price:.2f}", i.unit_label,
            i.category.name if i.category else "", i.updated_at.isoformat() if i.updated_at else ""
        ]
        text_buf.append(",".join(f'"{str(v).replace(chr(34), chr(39))}"' for v in row) + "\n")
    output.write("".join(text_buf).encode("utf-8"))
    output.seek(0)
    return send_file(output, mimetype="text/csv", as_attachment=True, download_name="shoply_items.csv")


@app.route("/api/export/other-costs.csv")
def export_other_costs_csv():
    output = BytesIO()
    text_buf = ["payee,category,amount,direction,status,due_date,paid_date,notes\n"]
    costs = OtherCost.query.order_by(OtherCost.created_at.asc()).all()
    for c in costs:
        row = [
            c.payee, c.category, f"{c.amount:.2f}", c.direction, c.status,
            c.due_date.isoformat() if c.due_date else "",
            c.paid_date.isoformat() if c.paid_date else "",
            c.notes or "",
        ]
        text_buf.append(",".join(f'"{str(v).replace(chr(34), chr(39))}"' for v in row) + "\n")
    output.write("".join(text_buf).encode("utf-8"))
    output.seek(0)
    return send_file(output, mimetype="text/csv", as_attachment=True, download_name="shoply_other_costs.csv")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("FLASK_DEBUG", "false").lower() == "true")
