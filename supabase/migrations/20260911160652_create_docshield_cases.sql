/*
# Create DocShield screening cases

1. New Tables
- `docshield_cases`
- `id` (uuid, primary key)
- `case_id` (text, unique human-readable case identifier)
- `document_name` (text, uploaded document label)
- `document_type` (text, detected document type)
- `risk_score` (integer, calculated score from 0-100)
- `risk_level` (text, LOW, MEDIUM, or HIGH)
- `status` (text, current case workflow status)
- `signals` (jsonb, explainable screening signals)
- `created_at` (timestamp)

2. Security
- Enable row level security.
- Allow anonymous and authenticated users to read, create, update, and delete shared prototype cases because this demo has no sign-in screen.

3. Important Notes
- This table stores prototype screening history only.
- No personal identity data is required for the demo.
*/

CREATE TABLE IF NOT EXISTS docshield_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id text UNIQUE NOT NULL,
  document_name text NOT NULL,
  document_type text NOT NULL DEFAULT 'Identity document',
  risk_score integer NOT NULL DEFAULT 0,
  risk_level text NOT NULL DEFAULT 'LOW',
  status text NOT NULL DEFAULT 'PENDING REVIEW',
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE docshield_cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Prototype users can view cases" ON docshield_cases;
CREATE POLICY "Prototype users can view cases" ON docshield_cases FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Prototype users can create cases" ON docshield_cases;
CREATE POLICY "Prototype users can create cases" ON docshield_cases FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Prototype users can update cases" ON docshield_cases;
CREATE POLICY "Prototype users can update cases" ON docshield_cases FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Prototype users can delete cases" ON docshield_cases;
CREATE POLICY "Prototype users can delete cases" ON docshield_cases FOR DELETE TO anon, authenticated USING (true);
