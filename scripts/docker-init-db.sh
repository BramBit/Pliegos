#!/bin/bash
set -e

# Automatically create the test database alongside the primary database on first initialization
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE pliegos_test'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'pliegos_test')\gexec
EOSQL
