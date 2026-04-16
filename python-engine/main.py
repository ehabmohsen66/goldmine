from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import pandas as pd
from typing import List, Optional
import os

app = FastAPI()

# Only load model if we are executing within Python context that supports it
# (Railway will install requirements, but let's make it robust so build steps won't crash)
try:
    from model import Kronos, KronosTokenizer, KronosPredictor
    import torch
    
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Loading Kronos on {device}...")
    tokenizer = KronosTokenizer.from_pretrained("NeoQuasar/Kronos-Tokenizer-base")
    _model = Kronos.from_pretrained("NeoQuasar/Kronos-base").to(device)
    predictor = KronosPredictor(_model, tokenizer, max_context=512)
    print("Kronos loaded successfully.")
except ImportError:
    predictor = None
    print("Warning: Kronos dependencies not installed. Predictor disabled.")

class Candle(BaseModel):
    open: float
    high: float
    low: float
    close: float
    volume: Optional[float] = 0.0
    amount: Optional[float] = 0.0
    timestamp: str

class PredictRequest(BaseModel):
    symbol: str
    lookback: int = 400
    pred_len: int = 120
    candles: List[Candle]
    freq: str = "15T" # frequency, e.g. 15min

@app.post("/predict")
def predict(request: PredictRequest):
    if predictor is None:
        raise HTTPException(status_code=503, detail="Predictor engine is not available")
    
    try:
        # Convert JSON candles to DataFrame
        df = pd.DataFrame([{
            'open': c.open,
            'high': c.high,
            'low': c.low,
            'close': c.close,
            'volume': c.volume,
            'amount': c.amount,
            'timestamps': pd.to_datetime(c.timestamp)
        } for c in request.candles])
        
        # Ensure we have enough data or just use what we have (pad/truncate safely)
        # Kronos max context is 512, ensure we don't exceed or we truncate from start
        input_len = min(len(df), request.lookback, 512)
        df = df.iloc[-input_len:].reset_index(drop=True)

        x_df = df.loc[:, ['open', 'high', 'low', 'close', 'volume', 'amount']]
        x_timestamp = df['timestamps']
        
        # Generate future timestamps
        # Use simple date range matching the provided frequency (e.g. 15min)
        # pandas date_range requires standard offset format like '15T', '1D'
        y_timestamp = pd.date_range(
            start=x_timestamp.iloc[-1], 
            periods=request.pred_len + 1, 
            freq=request.freq
        )[1:]
        
        pred_df = predictor.predict(
            df=x_df,
            x_timestamp=x_timestamp,
            y_timestamp=y_timestamp,
            pred_len=request.pred_len,
            T=1.0, 
            top_p=0.9,
            sample_count=1
        )
        
        # Format response
        result = pred_df.reset_index(names='timestamp')
        result['timestamp'] = result['timestamp'].dt.strftime('%Y-%m-%dT%H:%M:%S%z')
        
        return {
            "symbol": request.symbol,
            "forecast": result.to_dict(orient='records')
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
