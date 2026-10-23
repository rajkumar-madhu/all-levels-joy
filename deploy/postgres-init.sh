#!/bin/sh
# Runs once, as the PostgreSQL superuser, when the database volume is first created.
# service_role needs BYPASSRLS, which only a superuser can grant, so the platform roles are made here.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" \
  -v itsm_password="$ITSM_DB_PASSWORD" -v keycloak_password="$KEYCLOAK_DB_PASSWORD" <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE itsm_api LOGIN NOINHERIT PASSWORD :'itsm_password';
GRANT anon, authenticated, service_role TO itsm_api;
CREATE DATABASE itsm OWNER itsm_api;
CREATE ROLE keycloak LOGIN PASSWORD :'keycloak_password';
CREATE DATABASE keycloak OWNER keycloak;
SQL
