-- Migration 003: Add alerted column to faults table for watchdog tracking
ALTER TABLE faults ADD COLUMN alerted INTEGER NOT NULL DEFAULT 0;
