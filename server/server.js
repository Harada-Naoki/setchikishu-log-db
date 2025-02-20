require("dotenv").config(); // 環境変数を読み込む

const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");

const app = express();
app.use(express.json());
app.use(cors());

// MySQL接続設定
// const db = mysql.createConnection({
//   host: process.env.DB_HOST,
//   user: process.env.DB_USER,
//   password: process.env.DB_PASSWORD,
//   database: process.env.DB_NAME,
//   charset: "utf8mb4" // 日本語対応
// });

// MySQL (TiDB) データベース接続設定
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 4000,
  ssl: { rejectUnauthorized: true }  // TiDB は SSL 必須
});

db.connect(err => {
  if (err) {
    console.error("MySQL接続エラー:", err);
  } else {
    console.log("MySQL接続成功");
  }
});

// 📌 競合店の機種データを登録するAPI
app.post("/add-machine", (req, res) => {
  const { storeName, competitorName, category, machines } = req.body;

  db.query("SELECT id FROM stores WHERE store_name = ?", [storeName], (err, storeResult) => {
    if (err || storeResult.length === 0) {
      console.error("❌ エラー: 自店が見つかりません");
      return res.status(400).json({ error: "自店が見つかりません" });
    }
    const storeId = storeResult[0].id;

    db.query("SELECT id FROM competitor_stores WHERE store_id = ? AND competitor_name = ?", 
      [storeId, competitorName], (err, compResult) => {
      if (err || compResult.length === 0) {
        console.error("❌ エラー: 競合店が見つかりません");
        return res.status(400).json({ error: "競合店が見つかりません" });
      }
      const competitorId = compResult[0].id;

      db.query("SELECT id FROM categories WHERE category_name = ?", [category], (err, catResult) => {
        if (err || catResult.length === 0) {
          console.error("❌ エラー: カテゴリーが見つかりません");
          return res.status(400).json({ error: "カテゴリーが見つかりません" });
        }
        const categoryId = catResult[0].id;
        
        // Stage 1: Basic normalization
        function basicNormalize(text) {
          return text
            // Convert full-width to half-width
            .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => {
              return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
            })
            .replace(/　/g, ' ')
            // Basic symbol normalization
            .replace(/[~〜～]/g, '')
            .replace(/[【】\[\]]/g, '')
            .replace(/[‐－ｰ\-]/g, '')
            .replace(/\s+/g, '')
            .trim();
        }

        // Stage 2: Game-specific normalization
        function gameSpecificNormalize(text) {
          return text
            .replace(/ぱちんこ|パチンコ/gi, '')
            .replace(/^(.\b)?パチスロ/i, '$1')
            .replace(/^(.\b)?ﾊﾟﾁｽﾛ/i, '$1')
            .replace(/^(.\b)?スロット/i, '$1')
            .replace(/^(.\b)?ｽﾛｯﾄ/i, '$1')
            .replace(/^PACHISLOT|^pachislot/i, '')
            .replace(/^SLOT|^slot/i, '')
            .trim();
        }

        const cleanedMachines = machines.map(({ machine, quantity }) => ({
          originalName: machine,
          stage1Clean: basicNormalize(machine),
          stage2Clean: gameSpecificNormalize(basicNormalize(machine)),
          quantity
        }));

        // console.log("🔍 正規化後のデータ:", cleanedMachines);

        const queries = cleanedMachines.map(({ originalName, stage1Clean, stage2Clean }) => {
          return new Promise((resolve, reject) => {
            // Stage 1: Try matching with basic normalization
            const basicNormalizeQuery = `
              SELECT id, machine_name 
              FROM machine_master 
              WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                machine_name, '-', ''), '‐', ''), '－', ''), ' ', ''), '　', ''), '~', ''), '〜', ''), '～', ''), '【', ''), '】', '') 
              COLLATE utf8mb4_unicode_ci
              LIKE CONCAT('%', ?, '%')
              ORDER BY LENGTH(REGEXP_REPLACE(machine_name, '【.*?】', '')) ASC 
              LIMIT 1
            `;

            db.query(basicNormalizeQuery, [stage1Clean], (err, stage1Result) => {
              if (err) {
                console.error("❌ Stage 1 検索エラー:", err);
                return reject(err);
              }

              if (stage1Result.length > 0) {
                console.log(`✅ Stage 1 一致: inputName=${originalName}, matched=${stage1Result[0].machine_name}`);
                return resolve({
                  inputName: originalName,
                  masterId: stage1Result[0].id,
                  matchStage: 1
                });
              }

              // Stage 2: Try matching with game-specific normalization
              db.query(basicNormalizeQuery, [stage2Clean], (err, stage2Result) => {
                if (err) {
                  console.error("❌ Stage 2 検索エラー:", err);
                  return reject(err);
                }

                if (stage2Result.length > 0) {
                  console.log(`✅ Stage 2 一致: inputName=${originalName}, matched=${stage2Result[0].machine_name}`);
                  return resolve({
                    inputName: originalName,
                    masterId: stage2Result[0].id,
                    matchStage: 2
                  });
                }

                // Stage 3: Try Levenshtein distance matching
                db.query(`
                  SELECT id, machine_name, LEVENSHTEIN_DISTANCE(
                    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      machine_name, '-', ''), '‐', ''), '－', ''), ' ', ''), '　', ''), '~', ''), '〜', ''), '～', ''), '【', ''), '】', ''),
                    ? COLLATE utf8mb4_unicode_ci
                  ) AS distance 
                  FROM machine_master 
                  HAVING distance <= 5
                  ORDER BY distance ASC, LENGTH(REGEXP_REPLACE(machine_name, '【.*?】', '')) ASC
                  LIMIT 1
                `, [stage2Clean], (err, stage3Result) => {
                  if (err) {
                    console.error("❌ Stage 3 検索エラー:", err);
                    return reject(err);
                  }

                  if (stage3Result.length > 0) {
                    console.log(`✅ Stage 3 一致: inputName=${originalName}, matched=${stage3Result[0].machine_name}`);
                  } else {
                    console.warn(`⚠️ 不一致: inputName=${originalName}`);
                  }

                  resolve({
                    inputName: originalName,
                    masterId: stage3Result.length > 0 ? stage3Result[0].id : null,
                    matchStage: stage3Result.length > 0 ? 3 : null
                  });
                });
              });
            });
          });
        });

        Promise.all(queries)
          .then(results => {

            const masterIds = results.map(r => r.masterId).filter(id => id !== null);
            if (masterIds.length === 0) {
              return res.status(400).json({ error: "登録するデータがありません" });
            }

            db.query(
              "SELECT id, sis_code FROM machine_master WHERE id IN (?)",
              [masterIds],
              (err, sisCodeResults) => {
                if (err) {
                  console.error("❌ sis_code 取得エラー:", err);
                  return res.status(500).json({ error: "sis_code 取得エラー" });
                }

                const sisCodeMap = {};
                sisCodeResults.forEach(({ id, sis_code }) => {
                  sisCodeMap[id] = sis_code;
                });

                const values = cleanedMachines.map(({ originalName, quantity }) => {
                  const result = results.find(r => r.inputName === originalName);
                  const masterId = result?.masterId || null;
                  const sisCode = masterId ? sisCodeMap[masterId] || null : null;
                  return [competitorId, categoryId, originalName, masterId, sisCode, quantity];
                });

                db.query(
                  `INSERT INTO machine_data (competitor_id, category_id, machine_name, machine_master_id, sis_code, quantity) 
                   VALUES ? 
                   ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), sis_code = VALUES(sis_code), updated_at = NOW()`,
                  [values],
                  (err) => {
                    if (err) {
                      console.error("❌ データ登録エラー:", err);
                      return res.status(500).json({ error: "データ登録エラー" });
                    }

                    console.log("✅ データ登録成功");
                    res.json({ message: "データ登録成功" });
                  }
                );
              }
            );
          })
          .catch(err => res.status(500).json({ error: "機種情報取得エラー" }));
      });
    });
  });
});

// 📌 自店と競合店を取得するAPI
app.get("/get-stores", (req, res) => {
  const query = `
    SELECT s.store_name, GROUP_CONCAT(c.competitor_name) AS competitors
    FROM stores s
    LEFT JOIN competitor_stores c ON s.id = c.store_id
    GROUP BY s.store_name;
  `;

  db.query(query, (err, results) => {
    if (err) {
      return res.status(500).json({ error: "データ取得エラー" });
    }

    // フォーマットを調整
    const storeList = results.map(row => ({
      name: row.store_name,
      competitors: row.competitors ? row.competitors.split(",") : []
    }));

    res.json(storeList);
  });
});

// 📌 種別を取得するAPI
app.get("/get-types", (req, res) => {
  const query = "SELECT category_name FROM categories ORDER BY sort_order ASC";

  db.query(query, (err, results) => {
    if (err) {
      return res.status(500).json({ error: "データ取得エラー" });
    }

    const typeOptions = results.map(row => row.category_name);
    res.json(typeOptions);
  });
});

// 📌 競合店を追加するAPI
app.post("/add-competitor", (req, res) => {
  const { storeName, competitorName } = req.body;

  // 自店IDを取得
  db.query("SELECT id FROM stores WHERE store_name = ?", [storeName], (err, storeResult) => {
    if (err || storeResult.length === 0) {
      return res.status(400).json({ error: "自店が見つかりません" });
    }
    const storeId = storeResult[0].id;

    // 競合店を追加（重複チェックあり）
    db.query(
      "INSERT INTO competitor_stores (store_id, competitor_name) VALUES (?, ?) ON DUPLICATE KEY UPDATE competitor_name = VALUES(competitor_name)",
      [storeId, competitorName],
      (err, result) => {
        if (err) {
          return res.status(500).json({ error: "競合店の追加に失敗しました" });
        }
        res.json({ message: "競合店が追加されました", competitorName });
      }
    );
  });
});

// 📌 機種情報を取得するAPI
app.get("/get-machines", (req, res) => {
  const { storeName, competitorName, category } = req.query;

  // 競合店とカテゴリのIDを取得
  db.query(
    "SELECT id FROM stores WHERE store_name = ?",
    [storeName],
    (err, storeResult) => {
      if (err || storeResult.length === 0) {
        console.error("❌ エラー: 自店が見つかりません");
        return res.status(400).json({ error: "自店が見つかりません" });
      }
      const storeId = storeResult[0].id;

      db.query(
        "SELECT id FROM competitor_stores WHERE store_id = ? AND competitor_name = ?",
        [storeId, competitorName],
        (err, compResult) => {
          if (err || compResult.length === 0) {
            console.error("❌ エラー: 競合店が見つかりません");
            return res.status(400).json({ error: "競合店が見つかりません" });
          }
          const competitorId = compResult[0].id;

          db.query(
            "SELECT id FROM categories WHERE category_name = ?",
            [category],
            (err, catResult) => {
              if (err || catResult.length === 0) {
                console.error("❌ エラー: カテゴリーが見つかりません");
                return res.status(400).json({ error: "カテゴリーが見つかりません" });
              }
              const categoryId = catResult[0].id;

              // `machine_data` から最新の `updated_at` のレコードのみ取得
              const machineQuery = `
                SELECT machine_name, quantity, updated_at
                FROM machine_data
                WHERE competitor_id = ? AND category_id = ?
                AND updated_at = (
                  SELECT MAX(updated_at) 
                  FROM machine_data 
                  WHERE competitor_id = ? AND category_id = ?
                )
                ORDER BY quantity DESC
              `;

              db.query(machineQuery, [competitorId, categoryId, competitorId, categoryId], (err, results) => {
                if (err) {
                  console.error("❌ データ取得エラー:", err);
                  return res.status(500).json({ error: "データ取得エラー" });
                }

                res.json(results);
              });
            }
          );
        }
      );
    }
  );
});

// 📌 台数を更新するAPI
app.post("/update-machine-quantity", (req, res) => {
  const { machineName, competitorName, category, quantity } = req.body;

  if (!machineName || !competitorName || !category || quantity === undefined) {
    return res.status(400).json({ error: "すべての項目を入力してください" });
  }

  // `quantity` のみ更新（最新の `updated_at` のレコードを対象）
  const query = `
    UPDATE machine_data 
    SET quantity = ?, updated_at = updated_at 
    WHERE machine_name = ? 
    AND competitor_id = (SELECT id FROM competitor_stores WHERE competitor_name = ?) 
    AND category_id = (SELECT id FROM categories WHERE category_name = ?)
    AND updated_at = (
      SELECT MAX(updated_at) FROM machine_data 
      WHERE machine_name = ? 
      AND competitor_id = (SELECT id FROM competitor_stores WHERE competitor_name = ?) 
      AND category_id = (SELECT id FROM categories WHERE category_name = ?)
    )
  `;

  db.query(
    query, 
    [quantity, machineName, competitorName, category, machineName, competitorName, category],
    (err, result) => {
      if (err) {
        console.error("❌ 更新エラー:", err);
        return res.status(500).json({ error: "データ更新エラー" });
      }

      if (result.affectedRows === 0) {
        return res.status(400).json({ error: "最新のレコードが見つかりませんでした" });
      }

      res.json({ message: "台数を更新しました（最新レコードのみ対象、更新日時は変更なし）" });
    }
  );
});

// 📌 サーバー起動
app.listen(5000, () => console.log("サーバーがポート5000で起動"));
