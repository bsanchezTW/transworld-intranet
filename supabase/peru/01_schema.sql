-- =============================================================================
-- INTRANET PERÚ — schema (espejo de INTRANET CHILE - TW_P&T, con exclusiones)
-- Fuente introspectada: dgadjvptxhotjylwsglx (2026-08-12)
-- Aplicar en un proyecto Supabase vacío (solo schemas de sistema).
--
-- Exclusiones deliberadas vs Chile:
--   - linkedin_posts (feed LinkedIn solo Chile)
--   - No hay tabla de UF: el contador UF es solo API mindicador.cl en la app CL
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Enum vacaciones
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vacation_request_status') THEN
    CREATE TYPE public.vacation_request_status AS ENUM (
      'pending', 'approved', 'rejected', 'cancelled', 'in_progress', 'completed'
    );
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- Tablas base (sin FK a users)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.work_areas (
  id serial PRIMARY KEY,
  area_name character varying(150) NOT NULL,
  CONSTRAINT work_areas_area_name_key UNIQUE (area_name)
);

CREATE TABLE IF NOT EXISTS public.users (
  id serial PRIMARY KEY,
  first_name character varying(100),
  last_name character varying(100),
  email character varying(150),
  password_hash character varying(255),
  password_salt character varying(255),
  role character varying(50),
  email_confirmed boolean DEFAULT false,
  confirm_token character varying(255),
  confirm_expires timestamp without time zone,
  photo text,
  created_at timestamp without time zone DEFAULT now(),
  must_change_password boolean DEFAULT false,
  work_area_id integer REFERENCES public.work_areas(id),
  birth_date date,
  is_intranet_user boolean NOT NULL DEFAULT true,
  phone numeric,
  home_tutorial_seen boolean NOT NULL DEFAULT true,
  last_login_at timestamp with time zone,
  -- Default PE en esta instancia (Chile usa 'CL')
  employment_country character varying(2) NOT NULL DEFAULT 'PE'
    CHECK (employment_country IN ('CL', 'PE')),
  hire_date date,
  manager_user_id integer REFERENCES public.users(id) ON DELETE SET NULL,
  prior_years_credited numeric(4,1) NOT NULL DEFAULT 0,
  progressive_days_override numeric(4,1),
  work_days_per_week smallint NOT NULL DEFAULT 5
    CHECK (work_days_per_week BETWEEN 3 AND 6),
  CONSTRAINT users_email_key UNIQUE (email)
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx
  ON public.users (LOWER(TRIM(email)))
  WHERE email IS NOT NULL AND TRIM(email) <> '';

CREATE INDEX IF NOT EXISTS idx_users_employment_country ON public.users (employment_country);
CREATE INDEX IF NOT EXISTS idx_users_hire_date ON public.users (hire_date) WHERE hire_date IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.applications (
  id serial PRIMARY KEY,
  name character varying(255) NOT NULL,
  description text,
  url_pc text,
  url_apk text,
  qr_ios text,
  qr_apk text,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  changelog text,
  notified boolean DEFAULT true,
  icon_url text,
  url_ios text,
  url_web text
);

CREATE TABLE IF NOT EXISTS public.change_log (
  id serial PRIMARY KEY,
  user_id integer REFERENCES public.users(id) ON DELETE SET NULL,
  action character varying(255),
  section character varying(100),
  link_path text,
  created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.claude_conversations (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title character varying(255) NOT NULL,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_claude_conversations_user_id ON public.claude_conversations (user_id);
CREATE INDEX IF NOT EXISTS idx_claude_conversations_updated_at ON public.claude_conversations (updated_at DESC);

CREATE TABLE IF NOT EXISTS public.claude_daily_usage (
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  usage_date date NOT NULL DEFAULT CURRENT_DATE,
  message_count integer NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  file_count integer NOT NULL DEFAULT 0 CHECK (file_count >= 0),
  PRIMARY KEY (user_id, usage_date)
);

CREATE TABLE IF NOT EXISTS public.claude_messages (
  id serial PRIMARY KEY,
  conversation_id integer NOT NULL REFERENCES public.claude_conversations(id) ON DELETE CASCADE,
  role character varying(20) NOT NULL
    CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_claude_messages_conversation_id ON public.claude_messages (conversation_id);

CREATE TABLE IF NOT EXISTS public.claude_user_settings (
  user_id integer NOT NULL PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  limits_notice_seen_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.courses (
  id serial PRIMARY KEY,
  title character varying(255) NOT NULL,
  description text,
  material_url text,
  video_url text NOT NULL,
  required_watch_seconds integer NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  commercial_tips text,
  section character varying(255),
  subsection character varying(255)
);

CREATE TABLE IF NOT EXISTS public.documents (
  id serial PRIMARY KEY,
  name character varying(200) NOT NULL,
  type character varying(50) NOT NULL,
  url text NOT NULL,
  public_id character varying(100),
  user_id integer REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.events (
  id serial PRIMARY KEY,
  name character varying(200) NOT NULL,
  slug character varying(200) NOT NULL UNIQUE,
  description text,
  image text,
  created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_photos (
  id serial PRIMARY KEY,
  event_id integer REFERENCES public.events(id) ON DELETE CASCADE,
  url text NOT NULL,
  public_id character varying(100)
);

CREATE TABLE IF NOT EXISTS public.lunch_menu (
  id serial PRIMARY KEY,
  day_number integer NOT NULL UNIQUE,
  dish_name text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.news_articles (
  id serial PRIMARY KEY,
  title character varying(255) NOT NULL,
  subtitle character varying(255),
  content text NOT NULL,
  image text,
  public_id character varying(100),
  attachments jsonb DEFAULT '[]'::jsonb,
  created_at timestamp without time zone DEFAULT now(),
  slug character varying(100),
  author character varying(100),
  featured boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_news_articles_featured
  ON public.news_articles (featured) WHERE featured = true;

CREATE TABLE IF NOT EXISTS public.other_documents (
  id serial PRIMARY KEY,
  name text NOT NULL,
  url text NOT NULL,
  public_id text,
  created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.public_holidays (
  id serial PRIMARY KEY,
  country_code character varying(2) NOT NULL CHECK (country_code IN ('CL', 'PE')),
  holiday_date date NOT NULL,
  name character varying(200) NOT NULL,
  is_recurring boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (country_code, holiday_date)
);
CREATE INDEX IF NOT EXISTS idx_public_holidays_country_date
  ON public.public_holidays (country_code, holiday_date);

CREATE TABLE IF NOT EXISTS public.questions (
  id serial PRIMARY KEY,
  course_id integer REFERENCES public.courses(id) ON DELETE CASCADE,
  question_text text NOT NULL,
  sort_order integer DEFAULT 1,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  feedback text
);

CREATE TABLE IF NOT EXISTS public.question_options (
  id serial PRIMARY KEY,
  question_id integer REFERENCES public.questions(id) ON DELETE CASCADE,
  text text NOT NULL,
  is_correct boolean NOT NULL DEFAULT false,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.study_materials (
  id serial PRIMARY KEY,
  section character varying(255) NOT NULL,
  name character varying(255) NOT NULL,
  file_url text NOT NULL,
  public_id character varying(255) NOT NULL,
  resource_type character varying(50) NOT NULL,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.subsection_details (
  name character varying(255) PRIMARY KEY,
  image_url text
);

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id serial PRIMARY KEY,
  title character varying(200) NOT NULL,
  description text NOT NULL,
  category character varying(100),
  priority character varying(50),
  status character varying(50) DEFAULT 'Abierto',
  requester_name character varying(150),
  requester_email character varying(150),
  created_at timestamp without time zone DEFAULT now(),
  resolved_at timestamp without time zone,
  closed_at timestamp without time zone,
  auto_closed boolean DEFAULT false,
  attachments text DEFAULT '[]',
  read_by_user boolean DEFAULT true,
  read_by_admin boolean DEFAULT true,
  assigned_to character varying(255)
);

CREATE TABLE IF NOT EXISTS public.system_config (
  key text PRIMARY KEY,
  value text,
  updated_at timestamp without time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ticket_replies (
  id serial PRIMARY KEY,
  ticket_id integer REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  message text NOT NULL,
  sender character varying(150),
  file_url text,
  file_name text,
  file_type text,
  attachments jsonb DEFAULT '[]'::jsonb,
  created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_course_progress (
  id serial PRIMARY KEY,
  user_id integer REFERENCES public.users(id) ON DELETE CASCADE,
  course_id integer REFERENCES public.courses(id) ON DELETE CASCADE,
  seconds_watched integer DEFAULT 0,
  status character varying(50) DEFAULT 'en_progreso',
  score numeric(5,2),
  started_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamp without time zone,
  attempts integer DEFAULT 0,
  UNIQUE (user_id, course_id)
);

CREATE TABLE IF NOT EXISTS public.vacation_periods (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  country_code character varying(2) NOT NULL CHECK (country_code IN ('CL', 'PE')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  entitled_days numeric(5,2) NOT NULL,
  used_days numeric(5,2) NOT NULL DEFAULT 0,
  adjusted_days numeric(5,2) NOT NULL DEFAULT 0,
  expires_at date,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  protected_block_days_used numeric(5,2) NOT NULL DEFAULT 0,
  flexible_block_days_used numeric(5,2) NOT NULL DEFAULT 0,
  record_met boolean NOT NULL DEFAULT true,
  record_validated_by integer REFERENCES public.users(id) ON DELETE SET NULL,
  record_notes text,
  UNIQUE (user_id, period_start)
);
CREATE INDEX IF NOT EXISTS idx_vacation_periods_user ON public.vacation_periods (user_id);

CREATE TABLE IF NOT EXISTS public.vacation_requests (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  country_code character varying(2) NOT NULL CHECK (country_code IN ('CL', 'PE')),
  vacation_period_id integer REFERENCES public.vacation_periods(id) ON DELETE SET NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  business_days numeric(5,2),
  calendar_days integer,
  status public.vacation_request_status NOT NULL DEFAULT 'pending',
  requester_notes text,
  reviewer_notes text,
  reviewed_by integer REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  fraction_ack_at timestamp with time zone,
  policy_warning_ack boolean NOT NULL DEFAULT false,
  period_allocations jsonb,
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_vacation_requests_user ON public.vacation_requests (user_id);
CREATE INDEX IF NOT EXISTS idx_vacation_requests_status ON public.vacation_requests (status);
CREATE INDEX IF NOT EXISTS idx_vacation_requests_dates ON public.vacation_requests (start_date, end_date);

CREATE TABLE IF NOT EXISTS public.vacation_balance_adjustments (
  id serial PRIMARY KEY,
  vacation_period_id integer NOT NULL REFERENCES public.vacation_periods(id) ON DELETE CASCADE,
  adjusted_by integer NOT NULL REFERENCES public.users(id),
  days_delta numeric(5,2) NOT NULL,
  reason text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vacation_balance_adjustments_period
  ON public.vacation_balance_adjustments (vacation_period_id);

-- -----------------------------------------------------------------------------
-- Función usada por recuperación de contraseña
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.marcar_recuperacion_pass(
  email_input text,
  nuevo_password_hash text
)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE public.users
  SET password_hash = nuevo_password_hash,
      must_change_password = TRUE
  WHERE LOWER(email) = LOWER(email_input);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario con email % no encontrado', email_input;
  END IF;
END;
$function$;

-- -----------------------------------------------------------------------------
-- RLS: mismo estado que Chile (activado, sin policies)
-- La app Node usa DATABASE_URL con rol privilegiado → bypass RLS.
-- -----------------------------------------------------------------------------

ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claude_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claude_daily_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claude_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claude_user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lunch_menu ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.other_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subsection_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_course_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vacation_balance_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vacation_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vacation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_areas ENABLE ROW LEVEL SECURITY;

-- Grants mínimos para roles Supabase (por si usan Data API más adelante).
-- El backend sigue usando la connection string de Postgres.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON FUNCTION public.marcar_recuperacion_pass(text, text) TO service_role;
