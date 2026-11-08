-- GRBZ Facility Management System – Datenbankschema (SQLite)
-- Konventionen:
--   * id: UUID (TEXT), auch clientseitig erzeugbar (Offline-Erfassung)
--   * seq: globale Änderungsnummer für die Delta-Synchronisation
--   * version: Optimistic Locking (Konflikterkennung zwischen Geräten)
--   * deleted: Tombstone, damit Löschungen synchronisiert werden
--   * Zeitstempel: ISO-8601 UTC (Anzeige in Europe/Berlin)

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  employee_no TEXT UNIQUE,
  name TEXT NOT NULL,
  email TEXT UNIQUE COLLATE NOCASE,
  phone TEXT,
  street TEXT, zip TEXT, city TEXT,
  entry_date TEXT,
  role TEXT NOT NULL,
  legacy_employee_no TEXT,
  customer_id TEXT,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  customer_no TEXT UNIQUE,
  customer_type TEXT NOT NULL DEFAULT 'firma',
  company_name TEXT NOT NULL,
  contact_person TEXT, phone TEXT, email TEXT,
  billing_street TEXT, billing_zip TEXT, billing_city TEXT,
  contract_status TEXT NOT NULL DEFAULT 'aktiv',
  notes TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS contact_history (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  contact_date TEXT NOT NULL,
  channel TEXT, subject TEXT NOT NULL, notes TEXT,
  user_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS customer_services (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  service_id TEXT NOT NULL REFERENCES services(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS objects (
  id TEXT PRIMARY KEY,
  object_no TEXT UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  name TEXT NOT NULL,
  street TEXT, zip TEXT, city TEXT,
  contact_person TEXT, contact_phone TEXT,
  object_type TEXT,
  area_sqm REAL, floors INTEGER, rooms INTEGER,
  access_notes TEXT,
  contract_info TEXT,
  cleaning_interval TEXT,
  notes TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS object_employees (
  id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL REFERENCES objects(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  article_no TEXT UNIQUE,
  barcode TEXT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'verbrauchsmaterial',
  unit TEXT DEFAULT 'Stück',
  stock REAL NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 0,
  purchase_price REAL,
  supplier TEXT, location TEXT, notes TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  material_id TEXT NOT NULL REFERENCES materials(id),
  qty REAL NOT NULL,
  kind TEXT NOT NULL,
  object_id TEXT, order_id TEXT,
  user_id TEXT,
  note TEXT,
  moved_at TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS machines (
  id TEXT PRIMARY KEY,
  inventory_no TEXT UNIQUE,
  name TEXT NOT NULL,
  manufacturer TEXT, model TEXT,
  purchase_date TEXT, purchase_price REAL,
  serial_no TEXT,
  condition TEXT DEFAULT 'gut',
  location TEXT,
  responsible_user_id TEXT,
  maintenance_interval_days INTEGER,
  next_maintenance TEXT,
  notes TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS machine_events (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL REFERENCES machines(id),
  kind TEXT NOT NULL,
  event_date TEXT NOT NULL,
  description TEXT,
  cost REAL,
  performed_by TEXT,
  status TEXT DEFAULT 'erledigt',
  user_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS qr_codes (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  label TEXT UNIQUE,
  target_type TEXT NOT NULL CHECK (target_type IN ('object','area','machine','material')),
  object_id TEXT, area_type TEXT, area_name TEXT,
  machine_id TEXT, material_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  deactivated_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scans (
  id TEXT PRIMARY KEY,
  qr_code_id TEXT,
  raw TEXT,
  method TEXT,
  result TEXT NOT NULL,
  user_id TEXT,
  scanned_at TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS checklist_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  service_id TEXT,
  purpose TEXT NOT NULL DEFAULT 'reinigung',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS checklist_template_items (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES checklist_templates(id),
  position INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  photo_required INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS recurrences (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL, object_id TEXT NOT NULL, service_id TEXT,
  template_id TEXT,
  frequency TEXT NOT NULL,
  weekdays TEXT,
  interval_days INTEGER,
  start_date TEXT NOT NULL, end_date TEXT,
  start_time TEXT, planned_minutes INTEGER,
  assigned_user_id TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  generated_until TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_no TEXT UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  object_id TEXT NOT NULL REFERENCES objects(id),
  service_id TEXT,
  template_id TEXT,
  recurrence_id TEXT,
  scheduled_date TEXT NOT NULL,
  scheduled_time TEXT,
  planned_minutes INTEGER,
  assigned_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'geplant' CHECK (status IN ('geplant','in_bearbeitung','abgeschlossen','unterbrochen','mangel')),
  notes TEXT,
  final_report TEXT,
  started_at TEXT, completed_at TEXT,
  completed_by TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS order_checklist_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  position INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  photo_required INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL DEFAULT 'offen' CHECK (result IN ('offen','erledigt','nicht_erledigt','nicht_zutreffend','mangel')),
  comment TEXT,
  checked_by TEXT, checked_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  order_id TEXT, checklist_item_id TEXT, object_id TEXT, defect_id TEXT,
  winter_operation_id TEXT, machine_id TEXT, inspection_id TEXT,
  category TEXT NOT NULL DEFAULT 'sonstiges',
  comment TEXT,
  taken_at TEXT NOT NULL,
  user_id TEXT,
  file_name TEXT, mime TEXT, size INTEGER,
  customer_visible INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS time_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('arbeit','pause')),
  parent_id TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT,
  object_id TEXT, order_id TEXT,
  note TEXT,
  source TEXT NOT NULL DEFAULT 'stempel',
  recorded_start_at TEXT,
  recorded_end_at TEXT,
  voided INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS time_corrections (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES time_entries(id),
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  old_start_at TEXT, old_end_at TEXT, old_voided INTEGER,
  new_start_at TEXT, new_end_at TEXT, new_voided INTEGER,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'beantragt' CHECK (status IN ('beantragt','genehmigt','abgelehnt')),
  decided_by TEXT, decided_at TEXT, decision_comment TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inspections (
  id TEXT PRIMARY KEY,
  inspection_no TEXT UNIQUE,
  object_id TEXT NOT NULL,
  order_id TEXT,
  template_id TEXT,
  inspector_id TEXT,
  inspected_at TEXT NOT NULL,
  score REAL,
  rating TEXT,
  notes TEXT,
  customer_visible INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inspection_items (
  id TEXT PRIMARY KEY,
  inspection_id TEXT NOT NULL REFERENCES inspections(id),
  position INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  rating INTEGER,
  comment TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS defects (
  id TEXT PRIMARY KEY,
  defect_no TEXT UNIQUE,
  kind TEXT NOT NULL DEFAULT 'mangel' CHECK (kind IN ('mangel','reklamation','schaden')),
  customer_id TEXT, object_id TEXT, order_id TEXT, inspection_id TEXT, checklist_item_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  reported_by TEXT,
  reported_at TEXT NOT NULL,
  source TEXT DEFAULT 'intern',
  responsible_user_id TEXT,
  due_date TEXT,
  priority TEXT DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','in_bearbeitung','behoben','abgenommen','verworfen')),
  measures TEXT,
  resolved_at TEXT, resolved_by TEXT,
  resolution_note TEXT,
  customer_visible INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS defect_log (
  id TEXT PRIMARY KEY,
  defect_id TEXT NOT NULL REFERENCES defects(id),
  logged_at TEXT NOT NULL,
  user_id TEXT,
  action TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS winter_areas (
  id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL REFERENCES objects(id),
  kind TEXT NOT NULL DEFAULT 'gehweg',
  name TEXT NOT NULL,
  area_sqm REAL,
  priority INTEGER DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS winter_standby (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS winter_operations (
  id TEXT PRIMARY KEY,
  operation_no TEXT UNIQUE,
  season TEXT NOT NULL,
  object_id TEXT NOT NULL,
  user_id TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT,
  weather TEXT,
  temperature REAL,
  snow_cm REAL,
  area_ids TEXT,
  activity TEXT,
  spreading_material TEXT,
  spreading_amount_kg REAL,
  notes TEXT,
  signature TEXT,
  signed_at TEXT,
  status TEXT NOT NULL DEFAULT 'offen',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'sonstiges',
  customer_id TEXT, object_id TEXT, order_id TEXT, machine_id TEXT,
  file_name TEXT, original_name TEXT, mime TEXT, size INTEGER,
  sha256 TEXT,
  uploaded_by TEXT,
  customer_visible INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user_id TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  details TEXT,
  ip TEXT
);

CREATE TABLE IF NOT EXISTS sync_ops (
  op_id TEXT PRIMARY KEY,
  user_id TEXT,
  type TEXT,
  received_at TEXT NOT NULL,
  result TEXT
);

CREATE INDEX IF NOT EXISTS idx_objects_customer ON objects(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_orders_object ON orders(object_id);
CREATE INDEX IF NOT EXISTS idx_oci_order ON order_checklist_items(order_id);
CREATE INDEX IF NOT EXISTS idx_photos_order ON photos(order_id);
CREATE INDEX IF NOT EXISTS idx_time_user ON time_entries(user_id, start_at);
CREATE INDEX IF NOT EXISTS idx_stock_material ON stock_movements(material_id);
CREATE INDEX IF NOT EXISTS idx_defects_status ON defects(status);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
CREATE INDEX IF NOT EXISTS idx_scans_at ON scans(scanned_at);

-- =====================================================================
-- Personalverwaltung (Schema-Version 2)
-- =====================================================================
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  role_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  permissions TEXT NOT NULL DEFAULT '[]',
  scoped INTEGER NOT NULL DEFAULT 0,
  system INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 100,
  description TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS employment_types (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS work_models (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
  day_minutes TEXT NOT NULL DEFAULT '[0,0,0,0,0,0,0]',
  holidays_reduce INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

-- Personalakte (1:1 zu users, id = user_id). Vergütungsdaten nur mit Recht hr.salary sichtbar.
CREATE TABLE IF NOT EXISTS employee_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  birth_date TEXT, mobile TEXT, emergency_contact TEXT,
  exit_date TEXT,
  status TEXT NOT NULL DEFAULT 'aktiv',
  employment_type_id TEXT, position_id TEXT, department_id TEXT, supervisor_id TEXT,
  work_model_id TEXT, weekly_hours REAL,
  pay_type TEXT NOT NULL DEFAULT 'keine', hourly_rate REAL, monthly_salary REAL,
  vacation_days REAL, vacation_carryover REAL,
  contract_note TEXT, hr_notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS holidays (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, name TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS absences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  half_day INTEGER NOT NULL DEFAULT 0,
  days REAL NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 1,
  certificate INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'beantragt',
  note TEXT,
  requested_by TEXT, decided_by TEXT, decided_at TEXT, decision_note TEXT,
  substitute_user_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  object_id TEXT,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL, end_time TEXT NOT NULL,
  break_minutes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'geplant',
  replaces_user_id TEXT,
  note TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pay_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  category TEXT,
  scope_type TEXT NOT NULL DEFAULT 'alle',
  scope_id TEXT,
  params TEXT NOT NULL DEFAULT '{}',
  priority INTEGER NOT NULL DEFAULT 0,
  valid_from TEXT, valid_to TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pay_adjustments (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, month TEXT NOT NULL,
  kind TEXT NOT NULL, amount REAL NOT NULL, object_id TEXT, note TEXT, created_by TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS mileage_logs (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, date TEXT NOT NULL, km REAL NOT NULL, object_id TEXT, note TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS overtime_adjustments (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, date TEXT NOT NULL, minutes INTEGER NOT NULL, reason TEXT NOT NULL, created_by TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS object_revenues (
  id TEXT PRIMARY KEY, object_id TEXT NOT NULL, month TEXT NOT NULL, amount REAL NOT NULL, note TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_absences_user ON absences(user_id, start_date);
CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(date);
CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);
