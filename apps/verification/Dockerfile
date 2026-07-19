FROM python:3.14-alpine
WORKDIR /app
COPY apps/verification/requirements.container.txt ./requirements.txt
RUN apk add --no-cache py3-z3 \
    && Z3_LIBRARY="$(find /usr/lib -maxdepth 1 -type f -name 'libz3.so.*' | head -n 1)" \
    && test -n "${Z3_LIBRARY}" \
    && ln -s "${Z3_LIBRARY}" /usr/lib/libz3.so \
    && pip install --no-cache-dir -r requirements.txt
ENV PYTHONPATH=/usr/lib/python3.14/site-packages \
    Z3_LIBRARY_PATH=/usr/lib
COPY apps/verification/app ./app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
