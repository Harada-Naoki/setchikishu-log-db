require("dotenv").config(); // 環境変数を読み込む

const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");

const app = express();
app.use(express.json());
app.use(cors());

// MySQL接続設定
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: "utf8mb4" // 日本語対応
});

// MySQL (TiDB) データベース接続設定
// const db = mysql.createConnection({
//   host: process.env.DB_HOST,
//   user: process.env.DB_USER,
//   password: process.env.DB_PASSWORD,
//   database: process.env.DB_NAME,
//   port: process.env.DB_PORT || 4000,
//   ssl: { rejectUnauthorized: true }  
// });

db.connect(err => {
  if (err) {
    console.error("MySQL接続エラー:", err);
  } else {
    console.log("MySQL接続成功");
  }
});

// 📌 総台数の差を確認するAPI
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

        // ✅ 総台数を計算
        const totalQuantity = machines.reduce((sum, { quantity }) => sum + quantity, 0);
        console.log(`📊 総台数 (${category}): ${totalQuantity}`);

        // ✅ 既存の総台数を取得して比較
        const checkQuery = `SELECT \`${category}\` AS currentTotal FROM competitor_stores WHERE id = ?`;
        db.query(checkQuery, [competitorId], (err, checkResult) => {
          if (err) {
            console.error("❌ 現在の総台数取得エラー:", err);
            return res.status(500).json({ error: "総台数取得エラー" });
          }

          const currentTotal = checkResult[0]?.currentTotal || 0;
          const difference = Math.abs(currentTotal - totalQuantity);

          if (difference >= 1) {
            return res.json({
              message: `総台数に差異があります (${currentTotal} → ${totalQuantity})。確認してください。`,
              needsTotalQuantityConfirmation: true,
              competitorId,  
              category,
              categoryId,    
              totalQuantity, 
              machines,
            });
          }                  

          // **差分が小さい場合はそのまま更新**
          console.log("🛠 `insertOrUpdateMachineData` に渡す値:", { competitorId, category, categoryId, totalQuantity, machines });
          insertOrUpdateMachineData(competitorId, category, categoryId, totalQuantity, machines, res);
        });
      });
    });
  });
});

app.post("/confirm-machine-update", (req, res) => {
  const { storeName, competitorName, category, machines, totalQuantity } = req.body;

  if (!storeName || !competitorName || !category || !machines || machines.length === 0) {
    console.error("❌ エラー: 必要なデータが不足しています");
    return res.status(400).json({ error: "必要なデータが不足しています" });
  }

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

        const totalQuantity = machines.reduce((sum, { quantity }) => sum + quantity, 0);

        console.log("🛠 `confirm-machine-update` に渡す値:", { competitorId, category, categoryId, totalQuantity, machines });

        insertOrUpdateMachineData(competitorId, category, categoryId, totalQuantity, machines, res);
      });
    });
  });
});

// 📌 UIで確認後にデータを更新API
app.post("/confirm-update-machine", (req, res) => {
  console.log("🛠 受信したリクエストデータ:", req.body);

  const { competitorId, categoryId, totalQuantity, machines, updatedAt } = req.body;

  if (!Array.isArray(machines) || machines.length === 0) {
    console.error("❌ エラー: `machines` が無効です:", machines);
    return res.status(400).json({ error: "無効な `machines` データ" });
  }

  // **登録用データの整理**
  const values = machines.map(({ inputName, name_collection_id, sis_code, quantity }) => [
    competitorId, categoryId, inputName, name_collection_id, sis_code, quantity, updatedAt
  ]);

  // **データ登録**
  db.query(`
    INSERT INTO machine_data (competitor_id, category_id, machine_name, name_collection_id, sis_code, quantity, updated_at) 
    VALUES ? 
    ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), updated_at = VALUES(updated_at)
  `, [values], (err) => {
    if (err) {
      console.error("❌ ステージ3の登録エラー:", err);
      return res.status(500).json({ error: "ステージ3の登録エラー" });
    }

    console.log("✅ ステージ3のデータを正常に登録しました");
    res.json({ message: "登録完了" });
  });
});

// データを更新する関数**
function insertOrUpdateMachineData(competitorId, category, categoryId, totalQuantity, machines, res) {
  const updatedAt = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  
  function basicNormalize(text) {
    return text
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
      .replace(/　/g, ' ')
      .replace(/[~〜～]/g, '')
      .replace(/[【】\[\]]/g, '')
      .replace(/[‐－ｰ\-]/g, '')
      .replace(/\s+/g, '')
      .trim();
  }

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

  const queries = cleanedMachines.map(({ originalName, stage1Clean, stage2Clean, quantity }) => {
    return new Promise((resolve, reject) => {
      // **name_collection_id を取得**
      const query = `
        SELECT id, sis_code FROM name_collection 
        WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
          dotcom_machine_name, '-', ''), '‐', ''), '－', ''), ' ', ''), '　', ''), '~', ''), '〜', ''), '～', ''), '【', ''), '】', '') 
        COLLATE utf8mb4_unicode_ci
        LIKE CONCAT('%', ?, '%')
        ORDER BY LENGTH(REGEXP_REPLACE(dotcom_machine_name, '【.*?】', '')) ASC 
        LIMIT 1
      `;

      db.query(query, [stage1Clean], (err, stage1Result) => {
        if (err) return reject(err);
        if (stage1Result.length > 0) {
          return resolve({
            inputName: originalName,
            name_collection_id: stage1Result[0].id,
            sis_code: stage1Result[0].sis_code,
            matchStage: 1,
            quantity
          });
        }

        db.query(query, [stage2Clean], (err, stage2Result) => {
          if (err) return reject(err);
          if (stage2Result.length > 0) {
            return resolve({
              inputName: originalName,
              name_collection_id: stage2Result[0].id,
              sis_code: stage2Result[0].sis_code,
              matchStage: 2,
              quantity
            });
          }

          // **Levenshtein Distance で最も近いマッチを取得**
          db.query(`
            SELECT id, sis_code, dotcom_machine_name, LEVENSHTEIN_DISTANCE(
              REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                dotcom_machine_name, '-', ''), '‐', ''), '－', ''), ' ', ''), '　', ''), '~', ''), '〜', ''), '～', ''), '【', ''), '】', ''), 
              ? COLLATE utf8mb4_unicode_ci
            ) AS distance 
            FROM name_collection 
            HAVING distance <= 5
            ORDER BY distance ASC, LENGTH(REGEXP_REPLACE(dotcom_machine_name, '【.*?】', '')) ASC
            LIMIT 1
          `, [stage2Clean], (err, stage3Result) => {
            if (err) return reject(err);

            resolve({
              inputName: originalName,
              name_collection_id: stage3Result.length > 0 ? stage3Result[0].id : null,
              sis_code: stage3Result.length > 0 ? stage3Result[0].sis_code : null,
              matchStage: stage3Result.length > 0 ? 3 : null,
              quantity
            });
          });
        });
      });
    });
  });

  Promise.all(queries)
    .then(results => {
      // **ステージ1・2のデータ（確定しているデータ）**
      const stage1And2 = results.filter(r => r.matchStage === 1 || r.matchStage === 2);
      // **ステージ3のデータ（フロント確認が必要なデータ）**
      const stage3 = results.filter(r => r.matchStage === 3);

      // **ステージ1・2をDBに登録**
      if (stage1And2.length > 0) {
        const values = stage1And2.map(({ inputName, name_collection_id, sis_code, quantity }) => [
          competitorId, categoryId, inputName, name_collection_id, sis_code, quantity, updatedAt
        ]);

        db.query(`
          INSERT INTO machine_data 
          (competitor_id, category_id, machine_name, name_collection_id, sis_code, quantity, updated_at) 
          VALUES ? 
          ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), updated_at = VALUES(updated_at)
        `, [values], (err) => {
          if (err) {
            console.error("❌ データ登録エラー:", err);
            return res.status(500).json({ error: "データ登録エラー" });
          }
          console.log("✅ ステージ1・2のデータ登録成功");
        });
      }

      // **ステージ1・2のデータ登録後に総台数を更新**
      const updateQuery = `UPDATE competitor_stores SET \`${category}\` = ? WHERE id = ?`;
      db.query(updateQuery, [totalQuantity, competitorId], (err, updateResult) => {
        if (err) {
          console.error("❌ 総台数の更新エラー:", err);
          return res.status(500).json({ error: "総台数の更新エラー" });
        }
        console.log(`✅ 総台数 (${category}) を ${totalQuantity} に更新しました`);
      });

      // **ステージ3のデータをフロントに送信**
      if (stage3.length === 0) {
        return res.json({
          message: "登録完了（ステージ3の確認は不要）",
          competitorId,
          category,
          categoryId,
          totalQuantity,
          updatedAt
        });
      }

      // **ステージ3のデータに関して、補足情報（機種詳細など）を取得**
      const nameCollectionIds = stage3.map(r => r.name_collection_id).filter(id => id !== null);

      if (nameCollectionIds.length > 0) {
        // **まず name_collection テーブルから sis_code を取得**
        db.query(`SELECT id, sis_code FROM name_collection WHERE id IN (?)`, [nameCollectionIds], (err, sisCodeResults) => {
          if (err) {
            console.error("❌ name_collection から sis_code の取得エラー:", err);
            return res.status(500).json({ error: "sis_code の取得エラー" });
          }

          // **取得した sis_code を配列に変換**
          const sisCodes = sisCodeResults.map(row => row.sis_code).filter(code => code !== null);

          if (sisCodes.length === 0) {
            console.log("❌ name_collection から取得した sis_code が空です");
            return res.json({
              message: "確認が必要なデータがあります",
              needsStage3Confirmation: true,
              competitorId,
              category,
              categoryId,
              totalQuantity,
              machines: stage3,
              machineDetails: [],
              updatedAt
            });
          }

          // **sis_code を使って sis_machine_data から必要な情報を取得**
          db.query(`
            SELECT sis_machine_code, sis_type_code, cr_category, sis_maker_code, sis_machine_name
            FROM sis_machine_data
            WHERE sis_machine_code IN (?)
          `, [sisCodes], (err, machineDetails) => {
            if (err) {
              console.error("❌ sis_machine_data の取得エラー:", err);
              return res.status(500).json({ error: "機種情報取得エラー" });
            }

            console.log("🛠 `/insertOrUpdateMachineData` で送るデータ:", {
              competitorId,
              category,
              categoryId,
              totalQuantity,
              machines: stage3,
              machineDetails,
              updatedAt
            });

            return res.json({
              message: "確認が必要なデータがあります",
              needsStage3Confirmation: true,
              competitorId,
              category,
              categoryId,
              totalQuantity,
              machines: stage3,
              machineDetails,
              updatedAt
            });
          });
        });
      } else {
        // **name_collection_id が null の場合（完全に一致しない）**
        console.log("🛠 `/insertOrUpdateMachineData` で送るデータ（完全に一致しない）:", {
          competitorId,
          category,
          categoryId,
          totalQuantity,
          machines: stage3,
          updatedAt
        });

        return res.json({
          message: "確認が必要なデータがあります",
          needsStage3Confirmation: true,
          competitorId,
          category,
          categoryId,
          totalQuantity,
          machines: stage3,
          updatedAt
        });
      }
    })
    .catch(err => {
      console.error("❌ データ処理エラー:", err);
      res.status(500).json({ error: "データ処理エラー" });
    });
}

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
