-- Runs once as the PostgreSQL superuser when the compose database volume is created.
-- service_role needs BYPASSRLS, which only a superuser can grant, so the platform roles are made here.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE itsm_api LOGIN PASSWORD 'itsm_api_dev_password' NOINHERIT;
GRANT anon, authenticated, service_role TO itsm_api;
CREATE DATABASE itsm OWNER itsm_api;
CREATE DATABASE keycloak OWNER postgres;
