import pandas as pd
import numpy as np
from datetime import datetime, timedelta

def generate_5g_logs(filename="5g_telemetry.csv"):
    np.random.seed(42)
    timestamps = [datetime.now() - timedelta(minutes=i) for i in range(100, 0, -1)]
    
    # Normal 5G URLLC (Ultra-Reliable Low-Latency Communication) conditions
    # 5QI=82 is the 3GPP standard for discrete automation (10ms delay budget)
    data = {
        "timestamp": timestamps,
        "5QI": [82] * 100,
        "rsrp_dbm": np.random.normal(-80, 5, 100),  # Reference Signal Received Power
        "latency_ms": np.random.normal(8, 2, 100),
        "packet_loss_rate": np.random.uniform(0.0, 0.001, 100)
    }
    
    df = pd.DataFrame(data)
    
    # Inject an anomaly at T-20 minutes: Signal drop causes latency & packet loss spikes
    anomaly_idx = range(80, 90)
    df.loc[anomaly_idx, "rsrp_dbm"] = np.random.normal(-115, 3, 10) # Signal degraded
    df.loc[anomaly_idx, "latency_ms"] = np.random.normal(45, 10, 10) # Latency spikes
    df.loc[anomaly_idx, "packet_loss_rate"] = np.random.uniform(0.02, 0.05, 10) # Loss above 2%
    
    df.to_csv(filename, index=False)
    print(f"Generated {filename} with simulated 3GPP 5G NR telemetry.")

if __name__ == "__main__":
    generate_5g_logs()