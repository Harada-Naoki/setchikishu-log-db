require("dotenv").config(); // 環境変数を読み込む

const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
const axios = require("axios");

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

const FASTAPI_URL = process.env.FASTAPI_URL || "http://localhost:8000";

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

// 📌 総台数の差を確認し登録作業を進めるAPI
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

// 📌 総台数確認後に登録作業を進めるAPI
app.post("/confirm-add-machine", (req, res) => {
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

// 📌 UIで確認後にデータを更新するAPI
app.post("/confirm-update-machine", (req, res) => {
  const { competitorId, categoryId, totalQuantity, machines, machinesStage4, updatedAt } = req.body;

  if (!Array.isArray(machines) || !Array.isArray(machinesStage4)) {
    return res.status(400).json({ error: "無効なデータ形式" });
  }

  const updatePromises = [];

  const insertNameCollection = (inputName, sis_code) => {
    return new Promise((resolve, reject) => {
      const getMachineNameSql = "SELECT sis_machine_name FROM sis_machine_data WHERE sis_machine_code = ?";
      db.query(getMachineNameSql, [sis_code], (err, result) => {
        if (err) return reject(err);

        const sis_machine_name = result.length > 0 ? result[0].sis_machine_name : null;
        const insertSql = `
          INSERT INTO name_collection (dotcom_machine_name, sis_code, sis_machine_name, sis_registration_date)
          VALUES (?, ?, ?, ?)
        `;
        db.query(insertSql, [inputName, sis_code, sis_machine_name, updatedAt], (err, result) => {
          if (err) return reject(err);
          resolve(result.insertId);
        });
      });
    });
  };

  const updateMachineData = (inputName, name_collection_id, sis_code) => {
    return new Promise((resolve, reject) => {
      const updateSql = `
        UPDATE machine_data
        SET name_collection_id = ?, sis_code = ?
        WHERE machine_name = ?
      `;
      db.query(updateSql, [name_collection_id, sis_code, inputName], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  };

  const processMachines = (machines) => {
    return machines.map(({ inputName, sis_code }) => {
      return insertNameCollection(inputName, sis_code)
        .then((name_collection_id) => updateMachineData(inputName, name_collection_id, sis_code));
    });
  };

  updatePromises.push(...processMachines(machines));
  updatePromises.push(...processMachines(machinesStage4));

  Promise.all(updatePromises)
    .then(() => res.json({ message: "登録完了" }))
    .catch((err) => {
      console.error("❌ 更新エラー:", err);
      res.status(500).json({ error: "更新エラー" });
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

          // **ステージ3: Python の API にリクエスト**
          axios.get(`${FASTAPI_URL}/search?name=${encodeURIComponent(stage2Clean)}`)
          .then(response => {
            if (response.data.matchStage === 4) { // 🔹 ステージ4（マッチしなかった場合）
              return resolve({
                inputName: originalName,
                name_collection_id: null,
                sis_code: null,
                matchStage: 4, // ステージ4として管理
                quantity
              });
            }

            return resolve({
              inputName: originalName,
              name_collection_id: response.data.id,
              sis_code: response.data.sis_code,
              matchStage: 3, // ステージ3
              quantity
            });
          })
          .catch(error => {
            console.error("❌ Python API 呼び出しエラー:", error);
            return resolve({
              inputName: originalName,
              name_collection_id: null,
              sis_code: null,
              matchStage: 4, // ステージ4（エラー時も含める）
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

          // **ステージ4のデータ（マッチしなかったデータ）**
      const stage4 = results.filter(r => r.matchStage === 4);

      // ✅ **ステージ1・2・3・4すべてのデータをDBに登録**
      const allConfirmedMachines = [...stage1And2, ...stage3, ...stage4];

      if (allConfirmedMachines.length > 0) {
        const values = allConfirmedMachines.map(({ inputName, name_collection_id, sis_code, quantity }) => [
          competitorId, categoryId, inputName, name_collection_id || null, sis_code || null, quantity, updatedAt
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
          console.log("✅ ステージ1・2・3・4のデータ登録成功");
        });
      }
      // データ登録後に総台数を更新**
      const updateQuery = `UPDATE competitor_stores SET \`${category}\` = ? WHERE id = ?`;
      db.query(updateQuery, [totalQuantity, competitorId], (err, updateResult) => {
        if (err) {
          console.error("❌ 総台数の更新エラー:", err);
          return res.status(500).json({ error: "総台数の更新エラー" });
        }
        console.log(`✅ 総台数 (${category}) を ${totalQuantity} に更新しました`);
      });

      // **ステージ3とステージ4のデータをフロントに送信**
      if (stage3.length === 0 && stage4.length === 0) {
        return res.json({
          message: "登録完了（ステージ3・4の確認は不要）",
          competitorId,
          category,
          categoryId,
          totalQuantity,
          updatedAt
        });
      }

      // **ステージ3の詳細情報を取得**
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
              needsStage4Confirmation: stage4.length > 0, // 🔹 ステージ4がある場合
              competitorId,
              category,
              categoryId,
              totalQuantity,
              machines: stage3,
              machinesStage4: stage4, // 🔹 ステージ4のデータを追加
              machineDetails: [], // 🔹 ステージ3の詳細情報はない
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
              machinesStage4: stage4, // 🔹 ステージ4のデータを追加
              machineDetails,
              updatedAt
            });

            return res.json({
              message: "確認が必要なデータがあります",
              needsStage3Confirmation: true,
              needsStage4Confirmation: stage4.length > 0, // 🔹 ステージ4のデータがあるか
              competitorId,
              category,
              categoryId,
              totalQuantity,
              machines: stage3,
              machinesStage4: stage4, // 🔹 ステージ4のデータ
              machineDetails,
              updatedAt
            });
          });
        });
      } else {
        // 🔹 ステージ3の詳細なしで `stage4` を含めて送信
        return res.json({
          message: "確認が必要なデータがあります",
          needsStage3Confirmation: stage3.length > 0,
          needsStage4Confirmation: stage4.length > 0, // 🔹 ステージ4のデータがある場合
          competitorId,
          category,
          categoryId,
          totalQuantity,
          machines: stage3,
          machinesStage4: stage4, // 🔹 ステージ4のデータ
          machineDetails: [], // 🔹 ステージ3の詳細情報なし
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

// 📌 メーカーを取得するAPI
app.get('/get-sis-makers', (req, res) => {
  const sql = 'SELECT sis_maker_code, sis_maker_name FROM sis_maker_master';
  db.query(sql, (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(results);
  });
});

// 📌 機種タイプを取得するAPI
app.get('/get-sis-types', (req, res) => {
  const sql = 'SELECT sis_type_code, sis_type_name FROM sis_type_master';
  db.query(sql, (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(results);
  });
});

// 📌 指定された条件に合致する機種名を取得するAPI
app.get('/get-sis-machines', (req, res) => {
  const { category, maker, type, machineName } = req.query;

  if (!category) {
    return res.status(400).json({ error: "種別 (パチンコ or スロット) は必須です" });
  }

  let sql = `
    SELECT sis_machine_code, sis_machine_name 
    FROM sis_machine_data 
    WHERE cr_category = ?
  `;
  let params = [category];

  if (maker) {
    sql += " AND sis_maker_code = ?";
    params.push(maker);
  }

  if (type) {
    sql += " AND sis_type_code = ?";
    params.push(type);
  }

  if (machineName) {
    sql += " AND sis_machine_name LIKE ?";
    params.push(`%${machineName}%`);
  }

  sql += " ORDER BY machine_registration_date DESC"; // 登録日降順で並び替え

  db.query(sql, params, (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(results);
  });
});

// 📌 サーバー起動
app.listen(5000, () => console.log("サーバーがポート5000で起動"));
