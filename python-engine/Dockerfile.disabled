FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY . .

EXPOSE 8000

COPY start.sh ./start.sh
RUN chmod +x start.sh

CMD ["sh", "start.sh"]
