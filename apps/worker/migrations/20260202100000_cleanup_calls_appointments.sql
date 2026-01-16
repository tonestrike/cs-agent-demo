-- Cleanup call sessions, turns, and appointments while preserving customers.
DELETE FROM call_turns;
DELETE FROM call_sessions;
DELETE FROM appointments;
