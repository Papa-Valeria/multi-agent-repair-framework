# test_vuln.py
import sqlite3

def run_query(user_val):
    conn = sqlite3.connect("app.db")
    cursor = conn.cursor()
    query = "SELECT * FROM accounts WHERE id = %s" % user_val
    cursor.execute(query)
    return cursor.fetchall()
