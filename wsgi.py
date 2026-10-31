"""Production entry point:  gunicorn wsgi:app"""
from personalab.server import create_app, load_env

load_env()
app = create_app()
