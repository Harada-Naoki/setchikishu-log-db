from fastapi import FastAPI
import mysql.connector
import Levenshtein
import re
import os
from dotenv import load_dotenv

# 環境変数をロード
load_dotenv()

app = FastAPI()

# MySQL 接続情報
DB_CONFIG = {
    "host": os.getenv("DB_HOST"),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "database": os.getenv("DB_NAME")
}

# 特殊文字を削除する関数（データの正規化）
def normalize_name(name):
    return re.sub(r'[-‐－ 　~〜～【】]', '', name)

# 最も近い機種を検索する関数（Levenshtein 距離を使う）
def find_closest_machine(input_name):
    input_name = normalize_name(input_name)

    # MySQL から `name_collection` のデータを取得
    conn = mysql.connector.connect(**DB_CONFIG)
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT id, sis_code, dotcom_machine_name FROM name_collection")
    machines = cursor.fetchall()
    conn.close()

    closest_match = None
    min_distance = float("inf")

    # Levenshtein 距離を計算
    for machine in machines:
        db_name = normalize_name(machine["dotcom_machine_name"])
        distance = Levenshtein.distance(input_name, db_name)

        if distance < min_distance:
            min_distance = distance
            closest_match = machine

    if closest_match and min_distance <= 5:
        return closest_match
    else:
        return None

# 📌 API エンドポイント（Node.js からリクエストを受ける）
@app.get("/search")
def search_machine(name: str):
    closest_machine = find_closest_machine(name)
    if closest_machine:
        return {
            "id": closest_machine["id"],
            "sis_code": closest_machine["sis_code"],
            "name": closest_machine["dotcom_machine_name"],
            "matchStage": 3  # ステージ3として返す
        }
    
    # 🔹 マッチしなかった場合は `matchStage: 4` を返す
    return {
        "id": None,
        "sis_code": None,
        "name": None,
        "matchStage": 4
    }
