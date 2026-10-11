-- Schema PostgreSQL đề xuất để chuyển bản DEMO (localStorage) sang backend thật.
-- Ánh xạ 1-1 với các collection trong js/core/seed.js. Mọi bảng giao dịch KHÔNG xóa cứng (BR-12): dùng status + audit_logs.
CREATE TABLE roles (id text PRIMARY KEY, name text NOT NULL);
CREATE TABLE users (id text PRIMARY KEY, name text NOT NULL, title text, email text UNIQUE NOT NULL, role_id text REFERENCES roles, pw_hash text NOT NULL, salt text NOT NULL, active boolean DEFAULT true);
CREATE TABLE role_permissions (role_id text REFERENCES roles, module text, action text CHECK (action IN ('view','edit','approve','export')), PRIMARY KEY (role_id, module, action));
CREATE TABLE user_scopes (user_id text REFERENCES users, scope_type text CHECK (scope_type IN ('segment','warehouse','branch')), scope_id text, PRIMARY KEY (user_id, scope_type, scope_id));
CREATE TABLE business_units (id text PRIMARY KEY, code text UNIQUE, name text NOT NULL, parent_id text REFERENCES business_units, active boolean DEFAULT true, effective_from date, effective_to date);
CREATE TABLE warehouses (id text PRIMARY KEY, name text NOT NULL, segment_id text REFERENCES business_units);
CREATE TABLE customers (id text PRIMARY KEY, code text UNIQUE, name text NOT NULL, tax_code text, phone text, address text, payment_terms int DEFAULT 30, credit_limit numeric(18,0) DEFAULT 0, owner_id text REFERENCES users, status text DEFAULT 'active');
CREATE TABLE suppliers (id text PRIMARY KEY, code text UNIQUE, name text NOT NULL, segment_id text REFERENCES business_units, payment_terms int DEFAULT 30, contact text, phone text);
CREATE TABLE products (id text PRIMARY KEY, sku text UNIQUE NOT NULL, name text NOT NULL, grp text, segment_id text REFERENCES business_units, unit text, std_cost numeric(18,2), price numeric(18,2), min_qty numeric(18,4), expiry_tracked boolean DEFAULT false, active boolean DEFAULT true);
CREATE TABLE sales_orders (id text PRIMARY KEY, order_date date NOT NULL, delivered_at date, customer_id text REFERENCES customers, segment_id text REFERENCES business_units, owner_id text REFERENCES users, warehouse_id text REFERENCES warehouses, status text NOT NULL, returns numeric(18,0) DEFAULT 0, direct_cost numeric(18,0) DEFAULT 0, actual_cogs numeric(18,2), invoice_id text, note text);
CREATE TABLE sales_order_lines (order_id text REFERENCES sales_orders, line_no int, product_id text REFERENCES products, qty numeric(18,4) CHECK (qty > 0), price numeric(18,2) CHECK (price >= 0), discount numeric(5,4) CHECK (discount BETWEEN 0 AND 1), cost_snapshot numeric(18,2), PRIMARY KEY (order_id, line_no));
CREATE TABLE purchase_orders (id text PRIMARY KEY, po_date date NOT NULL, supplier_id text REFERENCES suppliers, segment_id text, warehouse_id text, requester_id text REFERENCES users, status text NOT NULL, note text);
CREATE TABLE purchase_order_lines (po_id text REFERENCES purchase_orders, line_no int, product_id text REFERENCES products, qty numeric(18,4) CHECK (qty > 0), cost numeric(18,2) CHECK (cost >= 0), PRIMARY KEY (po_id, line_no));
CREATE TABLE ar_ap_invoices (id text PRIMARY KEY, direction text CHECK (direction IN ('AR','AP')), no text NOT NULL, party_id text NOT NULL, order_id text, invoice_date date NOT NULL, due_date date NOT NULL, amount numeric(18,0) CHECK (amount > 0), source text, request_status text DEFAULT 'none', note text, UNIQUE (direction, no));
CREATE TABLE invoice_payments (id bigserial PRIMARY KEY, invoice_id text REFERENCES ar_ap_invoices, pay_date date NOT NULL, amount numeric(18,0) CHECK (amount > 0), cash_tx_id text, by_user text REFERENCES users, note text);
CREATE TABLE commitments (id text PRIMARY KEY, invoice_id text REFERENCES ar_ap_invoices, customer_id text REFERENCES customers, promise_date date, amount numeric(18,0), contact text, status text, created_by text, created_at date);
CREATE TABLE commitment_reminders (id bigserial PRIMARY KEY, commitment_id text REFERENCES commitments, at date, by_user text, result text);
CREATE TABLE cash_accounts (id text PRIMARY KEY, name text, opening_balance numeric(18,0));
CREATE TABLE cash_transactions (id text PRIMARY KEY, tx_date date NOT NULL, direction text CHECK (direction IN ('in','out')), amount numeric(18,0) CHECK (amount > 0), category text, account_id text REFERENCES cash_accounts, source_ref text, reconciled_at date, UNIQUE (tx_date, amount, direction, source_ref));
CREATE TABLE inventory_transactions (id text PRIMARY KEY, tx_date date NOT NULL, type text CHECK (type IN ('in','out','adjust','transfer','return')), product_id text REFERENCES products, warehouse_id text REFERENCES warehouses, to_warehouse_id text, qty numeric(18,4), unit_cost numeric(18,2), lot text, expiry date, source_ref text, reason text, approved_by text);
CREATE TABLE stocktakes (id text PRIMARY KEY, st_date date, warehouse_id text, reason text NOT NULL, status text, created_by text);
CREATE TABLE stocktake_lines (stocktake_id text REFERENCES stocktakes, product_id text, book_qty numeric(18,4), counted_qty numeric(18,4), PRIMARY KEY (stocktake_id, product_id));
CREATE TABLE expenses (id text PRIMARY KEY, exp_date date NOT NULL, category text, segment_id text, scope text CHECK (scope IN ('shared','direct')), amount numeric(18,0) CHECK (amount > 0), requester_id text, status text, note text, recurring_id text, doc_ref text);
CREATE TABLE budgets (id text PRIMARY KEY, period char(7) NOT NULL, segment_id text, category text NOT NULL, amount numeric(18,0) CHECK (amount >= 0), UNIQUE (period, segment_id, category));
CREATE TABLE recurring_costs (id text PRIMARY KEY, name text, category text, amount numeric(18,0), freq text, day int, segment_id text, scope text);
CREATE TABLE coffee_lots (id text PRIMARY KEY, lot_date date NOT NULL, supplier text, location text, kg numeric(18,2) CHECK (kg > 0), price_per_kg numeric(18,2) CHECK (price_per_kg > 0), out_kg numeric(18,2), moisture numeric(5,2), impurity numeric(5,2), coffee_type text, grade text, advance numeric(18,0) DEFAULT 0, created_by text);
CREATE TABLE coffee_lot_costs (lot_id text REFERENCES coffee_lots, cost_type text, amount numeric(18,0) CHECK (amount >= 0));
CREATE TABLE coffee_lot_sales (lot_id text PRIMARY KEY REFERENCES coffee_lots, sale_date date, kg numeric(18,2), price_per_kg numeric(18,2), buyer text);
CREATE TABLE ops_units (id text PRIMARY KEY, kind text CHECK (kind IN ('catam','nhayen')), name text, fish_count int, start_date date, area numeric, active boolean);
CREATE TABLE ops_records (id text PRIMARY KEY, kind text, unit_id text REFERENCES ops_units, rec_type text CHECK (rec_type IN ('cost','output','weight','loss')), rec_date date, category text, amount numeric(18,0), cls text CHECK (cls IN ('opex','capex')), kg numeric(18,2), price_per_kg numeric(18,2), avg_kg numeric(8,3), alive int, source text);
CREATE TABLE scenarios (id text PRIMARY KEY, name text, note text, vars jsonb, created_by text, created_at date);
CREATE TABLE forecast_snapshots (id text PRIMARY KEY, snap_date date, scenario text, by_user text, opening numeric(18,0), weeks jsonb);
CREATE TABLE approvals (id text PRIMARY KEY, type text, ref_id text, amount numeric(18,0), requester_id text, status text, title text, reasons jsonb, note text, approver_id text, decided_at timestamptz, decision_note text, created_at date);
CREATE TABLE tasks (id text PRIMARY KEY, title text, owner_id text, due date, ref_type text, ref_id text, status text, note text, created_by text, created_at date);
CREATE TABLE settings (key text PRIMARY KEY, value jsonb NOT NULL, confirmed boolean DEFAULT false);
CREATE TABLE period_locks (id bigserial PRIMARY KEY, locked_through date, by_user text, reason text, at timestamptz DEFAULT now());
CREATE TABLE audit_logs (id text PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), user_id text, user_name text, action text NOT NULL, entity text, entity_id text, before jsonb, after jsonb, reason text);
CREATE TABLE ai_runs (id text PRIMARY KEY, at timestamptz DEFAULT now(), user_id text, agent text, question text, intent text, sources jsonb, summary text, feedback text);
CREATE TABLE import_logs (id text PRIMARY KEY, at timestamptz DEFAULT now(), by_user text, entity text, file text, ok int, bad int);
-- Audit log: chỉ INSERT. Thu hồi UPDATE/DELETE bằng quyền DB.
-- REVOKE UPDATE, DELETE ON audit_logs FROM app_role;
-- RBAC phải được kiểm tra lại ở API (không chỉ ở giao diện) và dùng transaction cho cập nhật nhiều bảng (NFR-02).
