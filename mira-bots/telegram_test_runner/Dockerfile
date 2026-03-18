FROM python:3.12.13-slim
WORKDIR /app
COPY telegram_test_runner/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY telegram_test_runner/ .
ENV PYTHONUNBUFFERED=1
HEALTHCHECK --interval=30s --timeout=5s --retries=2 \
  CMD python -c "import os,sys; sys.exit(0 if os.path.exists(os.environ.get('TELEGRAM_TEST_SESSION_PATH','/session/test_account.session')) else 1)"
ENTRYPOINT ["python", "run_test.py"]
CMD ["--all"]
