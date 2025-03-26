require("dotenv").config(); // 環境変数を読み込む

const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
const path = require("path");

const app = express();

// CORSとボディサイズ制限
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.use(cors());

// MySQL接続設定
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: "utf8mb4" // 日本語対応
});

const CHECK_INTERVAL = 1000 * 60 * 5; // 5分

const checkDbConnection = () => {
  db.getConnection((err, connection) => {
    if (err) {
      console.error("【定期チェック】MySQL接続エラー:", err);
    } else {
      console.log("【定期チェック】MySQL接続成功");
      connection.release();
    }
  });
};

// 📌 総台数の差を確認し登録作業を進めるAPI
app.post("/add-machine", (req, res) => {
  const { storeName, competitorName, categories, isOwnStore } = req.body;

  console.log("🚀 API 呼び出し: /add-machine");
  console.log("📥 受信データ:", { storeName, competitorName, categories, isOwnStore });

  db.query("SELECT id FROM stores WHERE store_name = ?", [storeName], (err, storeResult) => {
    if (err || storeResult.length === 0) {
      console.error("❌ エラー: 自店が見つかりません -", storeName);
      return res.status(400).json({ error: "自店が見つかりません" });
    }
    const storeId = storeResult[0].id;
    console.log("✅ 自店取得成功 - storeId:", storeId);

    // 🔹 競合店のIDを取得（isOwnStoreがfalseの場合のみ）
    if (!isOwnStore) {
      db.query(
        "SELECT id FROM competitor_stores WHERE store_id = ? AND competitor_name = ?",
        [storeId, competitorName],
        (err, compResult) => {
          if (err || compResult.length === 0) {
            console.error("❌ エラー: 競合店が見つかりません -", competitorName);
            return res.status(400).json({ error: "競合店が見つかりません" });
          }
          const competitorId = compResult[0].id;
          console.log("✅ 競合店取得成功 - competitorId:", competitorId);

          // 🔹 カテゴリーごとに処理を実行
          processCategories(competitorId, "competitor_stores", categories, res, isOwnStore);
        }
      );
    } else {
      // 🔹 自店の場合、カテゴリーごとに処理を実行
      processCategories(storeId, "stores", categories, res, isOwnStore);
    }
  });
});

// 🔹 種別毎に追加処理
function processCategories(targetId, targetTable, categories, res, isOwnStore) {
  const categoryPromises = categories.map(({ category, machines }) => {
    return new Promise((resolve, reject) => {
      db.query("SELECT id FROM categories WHERE category_name = ?", [category], (err, catResult) => {
        if (err || catResult.length === 0) {
          console.error("❌ エラー: カテゴリーが見つかりません -", category);
          return reject(new Error(`カテゴリーが見つかりません (${category})`));
        }
        const categoryId = catResult[0].id;
        console.log("✅ カテゴリー取得成功 - categoryId:", categoryId);

        const totalQuantity = machines.reduce((sum, { quantity }) => sum + quantity, 0);
        console.log(`📊 総台数 (${category}): ${totalQuantity}`);

        checkAndInsert(targetId, targetTable, totalQuantity, category, categoryId, machines, isOwnStore)
          .then(resolve)
          .catch(reject);
      });
    });
  });

  Promise.all(categoryPromises)
    .then(results => {
      const needsConfirmation = results.some(r => r.needsTotalQuantityConfirmation);
      const missingSisCodes = results.flatMap(r => r.missingSisCodes || []);

      if (needsConfirmation) {
        console.warn("⚠️ 総台数に差異があります。フロントエンドに通知。");
        return res.json({
          message: "総台数に差異があります。確認してください。",
          categories: results.filter(r => r.needsTotalQuantityConfirmation),
          missingSisCodes
        });
      }

      console.log("✅ すべてのデータが正常に登録されました。");
      res.json({
        message: "データ登録成功",
        missingSisCodes
      });
    })
    .catch(error => {
      console.error("❌ エラー:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      }
    });
}

// 🔹 前回の台数との差を確認
function checkAndInsert(targetId, targetTable, totalQuantity, category, categoryId, machines, isOwnStore) {
  return new Promise((resolve, reject) => {
    const idColumn = "id"; 

    console.log(`🛠 データチェック: targetTable=${targetTable}, idColumn=${idColumn}, targetId=${targetId}, category=${category}`);

    db.query(`SHOW COLUMNS FROM ${targetTable}`, (err, columns) => {
      if (err) {
        console.error("❌ カラムリスト取得エラー:", err);
        return reject(new Error("カラムリスト取得エラー"));
      }

      if (!columns.map(col => col.Field).includes(category)) {
        console.error(`❌ エラー: ${targetTable} にカラム '${category}' が存在しません`);
        return reject(new Error(`カラム '${category}' が存在しません`));
      }

      const checkQuery = `SELECT \`${category}\` AS currentTotal FROM ${targetTable} WHERE ${idColumn} = ?`;

      db.query(checkQuery, [targetId], (err, checkResult) => {
        if (err) {
          console.error("❌ 現在の総台数取得エラー:", err);
          return reject(new Error("総台数取得エラー"));
        }

        const currentTotal = checkResult[0]?.currentTotal || 0;
        console.log(`📊 取得した現在の総台数 (category=${category}): ${currentTotal}`);

        const difference = totalQuantity - currentTotal;

        if (difference !== 0) {
          return resolve({
            message: `総台数に差異があります (${currentTotal} → ${totalQuantity})。\n確認してください。`,
            needsTotalQuantityConfirmation: true,
            isOwnStore,
            targetId,
            category,
            categoryId,
            currentTotal,
            totalQuantity,
            difference,
            machines,
          });
        }

        insertMachineData(targetId, categoryId, machines, isOwnStore)
          .then(result => {
            resolve({
              needsTotalQuantityConfirmation: false,
              missingSisCodes: result.missingSisCodes
            });
          })
          .catch(reject);
      });
    });
  });
}

// 📌 台数の確認後に処理を進めるAPI
app.post("/confirm-insert", (req, res) => {
  console.log("🚀 API 呼び出し: /confirm-insert");
  console.log("📥 受信データ:", req.body);

  const { storeName, competitorName, categories, isOwnStore } = req.body;

  if (!storeName || !categories || categories.length === 0) {
    console.error("❌ エラー: 必要なデータが不足");
    return res.status(400).json({ error: "必要なデータが不足しています" });
  }

  // **`storeId` を取得**
  db.query("SELECT id FROM stores WHERE store_name = ?", [storeName], (err, storeResult) => {
    if (err || storeResult.length === 0) {
      console.error("❌ エラー: 自店が見つかりません -", storeName);
      return res.status(400).json({ error: "自店が見つかりません" });
    }
    const storeId = storeResult[0].id;
    console.log("✅ 自店取得成功 - storeId:", storeId);

    // 🔹 競合店の ID を取得（`isOwnStore === false` の場合のみ）
    if (!isOwnStore) {
      db.query(
        "SELECT id FROM competitor_stores WHERE store_id = ? AND competitor_name = ?",
        [storeId, competitorName],
        (err, compResult) => {
          if (err || compResult.length === 0) {
            console.error("❌ エラー: 競合店が見つかりません -", competitorName);
            return res.status(400).json({ error: "競合店が見つかりません" });
          }
          const competitorId = compResult[0].id;
          console.log("✅ 競合店取得成功 - competitorId:", competitorId);

          // **データ登録処理**
          registerMachineData(competitorId, categories, isOwnStore, res, "competitor_stores");
        }
      );
    } else {
      // **自店のデータを登録**
      registerMachineData(storeId, categories, isOwnStore, res, "stores");
    }
  });
});

// 🔹 機種情報をDB登録
function registerMachineData(targetId, categories, isOwnStore, res, targetTable) {
  const categoryPromises = categories.map(({ category, machines, totalQuantity }) => {
    return new Promise((resolve, reject) => {
      // 🔹 `category_name` から `categoryId` を取得
      db.query("SELECT id FROM categories WHERE category_name = ?", [category], (err, catResult) => {
        if (err || catResult.length === 0) {
          console.error("❌ エラー: カテゴリーが見つかりません -", category);
          return reject(new Error(`カテゴリーが見つかりません (${category})`));
        }
        const categoryId = catResult[0].id;
        console.log("✅ カテゴリー取得成功 - categoryId:", categoryId);

        // 🔹 `insertMachineData()` を実行
        insertMachineData(targetId, categoryId, machines, isOwnStore)
          .then(({ message, missingSisCodes }) => {
            // 🔹 `totalQuantity` を `competitor_stores` または `stores` に更新
            updateTotalQuantity(targetTable, targetId, category, totalQuantity)
              .then(() => resolve({ category, message, missingSisCodes }))
              .catch(reject);
          })
          .catch(reject);
      });
    });
  });

  Promise.all(categoryPromises)
    .then(results => {
      // 🔹 すべてのカテゴリーの処理が完了
      const missingSisCodes = results.flatMap(r => r.missingSisCodes || []);

      console.log("✅ すべてのカテゴリーのデータ登録が完了");

      return res.json({
        message: "登録完了",
        missingSisCodes,
      });
    })
    .catch(error => {
      console.error("❌ エラー:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      }
    });
}

// 🔹 種別ごとの台数を更新
function updateTotalQuantity(targetTable, targetId, category, totalQuantity) {
  return new Promise((resolve, reject) => {
    const updateQuery = `UPDATE ${targetTable} SET \`${category}\` = ? WHERE id = ?`;
    
    db.query(updateQuery, [totalQuantity, targetId], (err, result) => {
      if (err) {
        console.error(`❌ 台数更新エラー (${category}):`, err);
        return reject(new Error(`台数更新エラー (${category})`));
      }
      console.log(`✅ 台数更新成功 (${category}):`, totalQuantity);
      resolve();
    });
  });
}

// 🔹 文字列正規化処理（空白・記号を削除）
function normalizeText(text) {
  return text
    .replace(/　/g, " ")  // 全角スペース → 半角スペース
    .replace(/[~〜～]/g, "")  // 波ダッシュ系削除
    .replace(/[【】\[\]]/g, "")  // 角カッコ削除
    .replace(/[‐－ｰ\-]/g, "")  // ハイフン・長音記号削除
    .replace(/[\/／\\＼]/g, "")  // スラッシュ & バックスラッシュ削除
    .replace(/\./g, "")
    .replace(/[:：]/g, "")  // **半角・全角の「：」を削除**
    .replace(/\s+/g, "")  // 余分なスペース削除
    .trim();
}

// 🔹 `sis_code` を取得しながら `INSERT`
function insertMachineData(targetId, categoryId, machines, isOwnStore) {
  return new Promise((resolve, reject) => {
    const targetTable = isOwnStore ? "store_machine_data" : "machine_data";
    const idColumn = isOwnStore ? "store_id" : "competitor_id";

    const machineQueries = machines.map(({ machine, quantity, aliases }) => {
      return new Promise((resolveMachine) => {
        if (!Array.isArray(aliases) || aliases.length === 0) {
          aliases = [];
        }

        // 🔹 `aliases` & `machine` を正規化し、空文字を除去
        const cleanedAliases = aliases.map(normalizeText).filter(alias => alias !== "");
        const cleanedMachine = normalizeText(machine);
        const searchTerms = Array.from(new Set([cleanedMachine, ...cleanedAliases]));

        // **完全一致検索**
        const exactMatchQuery = `
          SELECT sis_machine_code, sis_machine_name FROM sis_machine_data
          WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                    sis_machine_name, '　', ''), ' ', ''), '【', ''), '】', ''), '~', ''), '〜', ''), '～', ''), '-', ''), '‐', ''), '－', ''), 'ｰ', ''), '／', ''), '/', ''), '\', ''), '＼', ''), '.', ''), '：', ''), ':', ''), '[', ''), ']', '')     
          IN (${searchTerms.map(() => "?").join(", ")})
          LIMIT 1
        `;

        db.query(exactMatchQuery, searchTerms, (err, result) => {
          if (err) {
            console.error("❌ `sis_code` 取得エラー:", err);
            return resolveMachine({ machine, quantity, sis_code: null, aliases });
          }

          if (result.length > 0) {
            return resolveMachine({
              machine,
              quantity,
              sis_code: result[0].sis_machine_code,
              aliases,
            });
          }

          // **完全一致で見つからなかった場合、厳しめの部分一致検索**
          console.warn(`⚠️ 完全一致なし: ${machine} (正規化後: ${cleanedMachine})`);

          const strictPartialMatchQuery = `
            SELECT sis_machine_code, sis_machine_name 
            FROM sis_machine_data
            WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                    sis_machine_name, '　', ''), ' ', ''), '【', ''), '】', ''), '~', ''), '〜', ''), '～', ''), '-', ''), '‐', ''), '－', ''), 'ｰ', ''), '／', ''), '/', ''), '\', ''), '＼', ''), '.', ''), '：', ''), ':', ''), '[', ''), ']', '')
            LIKE ? 
            OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                    sis_machine_name, '　', ''), ' ', ''), '【', ''), '】', ''), '~', ''), '〜', ''), '～', ''), '-', ''), '‐', ''), '－', ''), 'ｰ', ''), '／', ''), '/', ''), '\', ''), '＼', ''), '.', ''), '：', ''), ':', ''), '[', ''), ']', '')
            LIKE ? 
            ORDER BY LENGTH(REGEXP_REPLACE(sis_machine_name, '【.*?】', '')) ASC
            LIMIT 1;
          `;

          const partialSearchTerms = [`%${cleanedMachine}%`, `%${cleanedMachine}%`];

          db.query(strictPartialMatchQuery, partialSearchTerms, (err, strictPartialResult) => {
            if (err) {
              console.error("❌ 厳しめ部分一致検索エラー:", err);
              return resolveMachine({ machine, quantity, sis_code: null, aliases });
            }

            console.log("🔍 厳しめ部分一致検索結果:", strictPartialResult);

            if (strictPartialResult.length > 0) {
              console.log(`✅ 厳しめ部分一致取得: ${machine} → ${strictPartialResult[0].sis_machine_code} (DB名: ${strictPartialResult[0].sis_machine_name})`);
              return resolveMachine({
                machine,
                quantity,
                sis_code: strictPartialResult[0].sis_machine_code,
                aliases,
              });
            }

            console.warn(`⚠️ 厳しめ部分一致も見つからず: ${machine} (正規化後: ${cleanedMachine})`);

            // **厳しめ部分一致でも見つからなかった場合、通常の部分一致検索**
            const partialMatchQuery = `
              SELECT sis_code, dotcom_machine_name FROM name_collection
              WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                    dotcom_machine_name, '　', ''), ' ', ''), '【', ''), '】', ''), '~', ''), '〜', ''), '～', ''), '-', ''), '‐', ''), '－', ''), 'ｰ', ''), '／', ''), '/', ''), '\', ''), '＼', ''), '.', ''), '：', ''), ':', ''), '[', ''), ']', '')
              COLLATE utf8mb4_general_ci
              LIKE CONCAT('%', ?, '%')
              ORDER BY LENGTH(REGEXP_REPLACE(dotcom_machine_name, '【.*?】', '')) ASC
              LIMIT 1
            `;

            db.query(partialMatchQuery, [cleanedMachine], (err, partialResult) => {
              if (err) {
                console.error("❌ 部分一致検索エラー:", err);
                return resolveMachine({ machine, quantity, sis_code: null, aliases });
              }

              if (partialResult.length > 0) {
                console.log(`✅ 部分一致取得: ${machine} → ${partialResult[0].sis_code} (DB名: ${partialResult[0].dotcom_machine_name})`);
                return resolveMachine({
                  machine,
                  quantity,
                  sis_code: partialResult[0].sis_code,
                  aliases,
                });
              }

              console.warn(`⚠️ 部分一致も見つからず: ${machine} (正規化後: ${cleanedMachine})`);
              resolveMachine({ machine, quantity, sis_code: null, aliases });
            });
          });
        });
      });
    });

    Promise.all(machineQueries).then((machineResults) => {
      const updatedAt = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }); // 🔹 `updated_at` をここで定義
      const missingSisCodes = machineResults
        .filter(m => m.sis_code === null)
        .map(({ machine, quantity }) => ({ 
          machine, 
          quantity, 
          updated_at: updatedAt // 🔹 `updated_at` を適切にセット
        })); 

      if (missingSisCodes.length > 0) {
        console.warn("⚠️ 未登録の `sis_code` のデータ:", missingSisCodes);
      }

      if (machineResults.length === 0) {
        console.warn("⚠️ 登録するデータがありません");
        return resolve({ message: "データ登録なし", missingSisCodes: [] });
      }

      const values = machineResults.map(({ machine, quantity, sis_code }) => [
        targetId,
        categoryId,
        machine,
        quantity,
        updatedAt, // 🔹 `updated_at` を適切に使用
        sis_code || null
      ]);

      const insertQuery = `
        INSERT INTO ${targetTable} 
        (${idColumn}, category_id, machine_name, quantity, updated_at, sis_code)
        VALUES ?
      `;

      db.query(insertQuery, [values], (err) => {
        if (err) {
          console.error("❌ データ登録エラー:", err);
          return reject(err);
        }

        resolve({ message: "データ登録成功", missingSisCodes });
      });
    }).catch((err) => {
          console.error("❌ `insertMachineData` 処理エラー:", err);
          reject(err);
    });
  });
}

// 📌 フロントエンドで確認したsis_codeをDBに反映させるAPI
app.post("/update-missing-sis-code", (req, res) => {
  const { machines, isOwnStore } = req.body;

  if (!Array.isArray(machines) || machines.length === 0) {
    return res.status(400).json({ error: "更新するデータがありません" });
  }

  // 🔹 自店なら `store_machine_data`、競合店なら `machine_data` を更新
  const targetTable = isOwnStore ? "store_machine_data" : "machine_data";

  const updatePromises = machines.map(({ machine, sis_code, updated_at }) => {
    return new Promise((resolve, reject) => {
      const updateSql = `
        UPDATE ${targetTable}
        SET sis_code = ?
        WHERE machine_name = ? AND sis_code IS NULL AND updated_at = ?
      `;

      db.query(updateSql, [sis_code, machine, updated_at], (err, result) => {
        if (err) return reject(err);
        
        if (result.affectedRows === 0) {
          console.warn(`⚠️ 更新対象なし: ${machine} (updated_at: ${updated_at})`);
          return resolve();
        }

        // 🔹 `name_collection` にデータを追加
        insertNameCollection(machine, sis_code, updated_at)
          .then(() => resolve())
          .catch(reject);
      });
    });
  });

  Promise.all(updatePromises)
    .then(() => res.json({ message: "更新完了" }))
    .catch((err) => {
      console.error("❌ 更新エラー:", err);
      res.status(500).json({ error: "更新エラー" });
    });
});

// 🔹 `name_collection` テーブルにデータを追加
const insertNameCollection = (inputName, sis_code, updatedAt) => {
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

// 📌 自店と競合店を取得するAPI
app.get("/get-stores", (req, res) => {
  const query = `
    SELECT s.id, s.store_name, GROUP_CONCAT(c.competitor_name ORDER BY c.competitor_name) AS competitors
    FROM stores s
    LEFT JOIN competitor_stores c ON s.id = c.store_id
    GROUP BY s.id, s.store_name
    ORDER BY s.id ASC;  -- 🔹 id の昇順に並び替え
  `;

  db.query(query, (err, results) => {
    if (err) {
      return res.status(500).json({ error: "データ取得エラー" });
    }

    // フォーマットを調整
    const storeList = results.map(row => ({
      id: row.id,
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

// 📌 最新の更新日時を取得するAPI
app.get("/get-latest-updates", (req, res) => {
  const { storeName, competitorName } = req.query;

  db.query("SELECT id FROM stores WHERE store_name = ?", [storeName], (err, storeResult) => {
    if (err || storeResult.length === 0) {
      console.error("❌ 自店が見つかりません");
      return res.status(400).json({ error: "自店が見つかりません" });
    }
    const storeId = storeResult[0].id;

    if (!competitorName || competitorName === "self") {
      // ✅ 自店用の更新日時取得
      const latestUpdatesQuery = `
        SELECT smd.category_id, c.category_name, MAX(smd.updated_at) AS latest_update
        FROM store_machine_data smd
        JOIN categories c ON smd.category_id = c.id
        WHERE smd.store_id = ?
        GROUP BY smd.category_id
        ORDER BY c.sort_order
      `;

      db.query(latestUpdatesQuery, [storeId], (err, results) => {
        if (err) {
          console.error("❌ 自店データ取得エラー:", err);
          return res.status(500).json({ error: "自店データ取得エラー" });
        }
        res.json(results);
      });

    } else {
      // ✅ 競合店用の更新日時取得
      db.query("SELECT id FROM competitor_stores WHERE store_id = ? AND competitor_name = ?", [storeId, competitorName], (err, compResult) => {
        if (err || compResult.length === 0) {
          console.error("❌ 競合店が見つかりません");
          return res.status(400).json({ error: "競合店が見つかりません" });
        }
        const competitorId = compResult[0].id;

        const latestUpdatesQuery = `
          SELECT md.category_id, c.category_name, MAX(md.updated_at) AS latest_update
          FROM machine_data md
          JOIN categories c ON md.category_id = c.id
          WHERE md.competitor_id = ?
          GROUP BY md.category_id
          ORDER BY c.sort_order
        `;

        db.query(latestUpdatesQuery, [competitorId], (err, results) => {
          if (err) {
            console.error("❌ データ取得エラー:", err);
            return res.status(500).json({ error: "データ取得エラー" });
          }
          res.json(results);
        });
      });
    }
  });
});

// 📌 機種情報を取得するAPI
app.get("/get-machines", (req, res) => {
  const { storeName, competitorName, category } = req.query;

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
        "SELECT id FROM categories WHERE category_name = ?",
        [category],
        (err, catResult) => {
          if (err || catResult.length === 0) {
            console.error("❌ エラー: カテゴリーが見つかりません");
            return res.status(400).json({ error: "カテゴリーが見つかりません" });
          }
          const categoryId = catResult[0].id;

          if (competitorName === "self") {
            // ✅ 自店データ取得
            const dateQuery = `
              SELECT DISTINCT updated_at
              FROM store_machine_data
              WHERE store_id = ? AND category_id = ?
              ORDER BY updated_at DESC
              LIMIT 2
            `;

            db.query(dateQuery, [storeId, categoryId], (err, dateResults) => {
              if (err || dateResults.length === 0) {
                console.error("❌ エラー: 更新日が見つかりません");
                return res.status(400).json({ error: "更新日が見つかりません" });
              }

              const latestDate = dateResults[0].updated_at;
              const previousDate = dateResults[1] ? dateResults[1].updated_at : null;

              const machineQuery = `
                SELECT machine_name, quantity, updated_at
                FROM store_machine_data
                WHERE store_id = ? AND category_id = ?
                AND updated_at IN (?, ?)
                ORDER BY updated_at DESC, quantity DESC
              `;

              const params = [
                storeId,
                categoryId,
                latestDate,
                previousDate || latestDate,
              ];

              db.query(machineQuery, params, (err, results) => {
                if (err) {
                  console.error("❌ 自店データ取得エラー:", err);
                  return res.status(500).json({ error: "データ取得エラー" });
                }

                const latest = results.filter(row => row.updated_at.getTime() === latestDate.getTime());
                const previous = previousDate
                  ? results.filter(row => row.updated_at.getTime() === previousDate.getTime())
                  : [];

                res.json({ latest, previous });
              });
            });

          } else {
            // ✅ 競合店データ取得
            db.query(
              "SELECT id FROM competitor_stores WHERE store_id = ? AND competitor_name = ?",
              [storeId, competitorName],
              (err, compResult) => {
                if (err || compResult.length === 0) {
                  console.error("❌ エラー: 競合店が見つかりません");
                  return res.status(400).json({ error: "競合店が見つかりません" });
                }
                const competitorId = compResult[0].id;

                const dateQuery = `
                  SELECT DISTINCT updated_at
                  FROM machine_data
                  WHERE competitor_id = ? AND category_id = ?
                  ORDER BY updated_at DESC
                  LIMIT 2
                `;

                db.query(dateQuery, [competitorId, categoryId], (err, dateResults) => {
                  if (err || dateResults.length === 0) {
                    console.error("❌ エラー: 更新日が見つかりません");
                    return res.status(400).json({ error: "更新日が見つかりません" });
                  }

                  const latestDate = dateResults[0].updated_at;
                  const previousDate = dateResults[1] ? dateResults[1].updated_at : null;

                  const machineQuery = `
                    SELECT machine_name, quantity, updated_at
                    FROM machine_data
                    WHERE competitor_id = ? AND category_id = ?
                    AND updated_at IN (?, ?)
                    ORDER BY updated_at DESC, quantity DESC
                  `;

                  const params = [
                    competitorId,
                    categoryId,
                    latestDate,
                    previousDate || latestDate,
                  ];

                  db.query(machineQuery, params, (err, results) => {
                    if (err) {
                      console.error("❌ 競合データ取得エラー:", err);
                      return res.status(500).json({ error: "データ取得エラー" });
                    }

                    const latest = results.filter(row => row.updated_at.getTime() === latestDate.getTime());
                    const previous = previousDate
                      ? results.filter(row => row.updated_at.getTime() === previousDate.getTime())
                      : [];

                    res.json({ latest, previous });
                  });
                });
              }
            );
          }
        }
      );
    }
  );
});

// 📌 台数を更新するAPI
app.post("/update-machine-quantity", (req, res) => {
  const { storeName, machineName, competitorName, category, quantity } = req.body;

  if (!storeName || !machineName || !competitorName || !category || quantity === undefined) {
    return res.status(400).json({ error: "すべての項目を入力してください" });
  }

  db.query("SELECT id FROM stores WHERE store_name = ?", [storeName], (err, storeResult) => {
    if (err || storeResult.length === 0) {
      console.error("❌ エラー: 自店が見つかりません", err);
      return res.status(400).json({ error: "自店が見つかりません" });
    }
    const storeId = storeResult[0].id;

    db.query("SELECT id FROM categories WHERE category_name = ?", [category], (err, catResult) => {
      if (err || catResult.length === 0) {
        console.error("❌ エラー: カテゴリーが見つかりません", err);
        return res.status(400).json({ error: "カテゴリーが見つかりません" });
      }
      const categoryId = catResult[0].id;

      if (competitorName === "self") {
        // ✅ 自店データの更新 (`store_machine_data`)
        const query = `
          UPDATE store_machine_data 
          SET quantity = ?, updated_at = updated_at 
          WHERE machine_name = ? 
          AND store_id = ? 
          AND category_id = ?
          AND updated_at = (
            SELECT MAX(updated_at) FROM store_machine_data 
            WHERE machine_name = ? 
            AND store_id = ? 
            AND category_id = ?
          )
        `;

        db.query(
          query, 
          [quantity, machineName, storeId, categoryId, machineName, storeId, categoryId],
          (err, result) => {
            if (err) {
              console.error("❌ 更新エラー:", err);
              return res.status(500).json({ error: "データ更新エラー" });
            }

            if (result.affectedRows === 0) {
              return res.status(400).json({ error: "最新のレコードが見つかりませんでした" });
            }

            res.json({ message: "自店の台数を更新しました（最新レコードのみ対象、更新日時は変更なし）" });
          }
        );
      } else {
        // ✅ 競合店データの更新 (`machine_data`)
        db.query("SELECT id FROM competitor_stores WHERE store_id = ? AND competitor_name = ?", 
          [storeId, competitorName], 
          (err, compResult) => {
            if (err || compResult.length === 0) {
              console.error("❌ エラー: 競合店が見つかりません", err);
              return res.status(400).json({ error: "競合店が見つかりません" });
            }
            const competitorId = compResult[0].id;

            const query = `
              UPDATE machine_data 
              SET quantity = ?, updated_at = updated_at 
              WHERE machine_name = ? 
              AND competitor_id = ? 
              AND category_id = ?
              AND updated_at = (
                SELECT MAX(updated_at) FROM machine_data 
                WHERE machine_name = ? 
                AND competitor_id = ? 
                AND category_id = ?
              )
            `;

            db.query(
              query, 
              [quantity, machineName, competitorId, categoryId, machineName, competitorId, categoryId],
              (err, result) => {
                if (err) {
                  console.error("❌ 更新エラー:", err);
                  return res.status(500).json({ error: "データ更新エラー" });
                }

                if (result.affectedRows === 0) {
                  return res.status(400).json({ error: "最新のレコードが見つかりませんでした" });
                }

                res.json({ message: "競合店の台数を更新しました（最新レコードのみ対象、更新日時は変更なし）" });
              }
            );
        });
      }
    });
  });
});

// 📌更新日時を取得するAPI（自店対応）
app.get("/get-updated-dates", (req, res) => {
  const { storeName, competitorName, category } = req.query;

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
        "SELECT id FROM categories WHERE category_name = ?",
        [category],
        (err, catResult) => {
          if (err || catResult.length === 0) {
            console.error("❌ エラー: カテゴリーが見つかりません");
            return res.status(400).json({ error: "カテゴリーが見つかりません" });
          }
          const categoryId = catResult[0].id;

          if (competitorName === "self") {
            // ✅ 自店の更新日時取得
            const dateQuery = `
              SELECT DISTINCT updated_at
              FROM store_machine_data
              WHERE store_id = ? AND category_id = ?
              ORDER BY updated_at DESC
            `;

            db.query(dateQuery, [storeId, categoryId], (err, results) => {
              if (err) {
                console.error("❌ 自店の更新日取得エラー:", err);
                return res.status(500).json({ error: "更新日取得エラー" });
              }
              res.json(results.map(row => row.updated_at));
            });

          } else {
            // ✅ 競合店の更新日時取得
            db.query(
              "SELECT id FROM competitor_stores WHERE store_id = ? AND competitor_name = ?",
              [storeId, competitorName],
              (err, compResult) => {
                if (err || compResult.length === 0) {
                  console.error("❌ エラー: 競合店が見つかりません");
                  return res.status(400).json({ error: "競合店が見つかりません" });
                }
                const competitorId = compResult[0].id;

                const dateQuery = `
                  SELECT DISTINCT updated_at
                  FROM machine_data
                  WHERE competitor_id = ? AND category_id = ?
                  ORDER BY updated_at DESC
                `;

                db.query(dateQuery, [competitorId, categoryId], (err, results) => {
                  if (err) {
                    console.error("❌ 競合店の更新日取得エラー:", err);
                    return res.status(500).json({ error: "更新日取得エラー" });
                  }
                  res.json(results.map(row => row.updated_at));
                });
              }
            );
          }
        }
      );
    }
  );
});

// 📌任意2日付のデータ取得API
app.get("/get-machines-by-dates", (req, res) => {
  const { storeName, competitorName, category, date1, date2 } = req.query;

  if (!date1 || !date2) {
    return res.status(400).json({ error: "日付が指定されていません" });
  }

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
        "SELECT id FROM categories WHERE category_name = ?",
        [category],
        (err, catResult) => {
          if (err || catResult.length === 0) {
            console.error("❌ エラー: カテゴリーが見つかりません");
            return res.status(400).json({ error: "カテゴリーが見つかりません" });
          }
          const categoryId = catResult[0].id;

          const parsedDate1 = new Date(date1);
          const parsedDate2 = new Date(date2);

          const targetDates = [parsedDate1.toISOString().split('T')[0], parsedDate2.toISOString().split('T')[0]];

          if (competitorName === "self") {
            // ✅ 自店データ取得
            const machineQuery = `
              SELECT machine_name, quantity, updated_at
              FROM store_machine_data
              WHERE store_id = ? AND category_id = ?
              AND DATE(updated_at) IN (?, ?)
              ORDER BY updated_at DESC, quantity DESC
            `;

            const params = [storeId, categoryId, ...targetDates];

            db.query(machineQuery, params, (err, results) => {
              if (err) {
                console.error("❌ 自店データ取得エラー:", err);
                return res.status(500).json({ error: "データ取得エラー" });
              }

              const data1 = results.filter(row => row.updated_at.toISOString().startsWith(targetDates[0]));
              const data2 = results.filter(row => row.updated_at.toISOString().startsWith(targetDates[1]));

              res.json({
                [targetDates[0]]: data1,
                [targetDates[1]]: data2
              });
            });

          } else {
            // ✅ 競合店データ取得
            db.query(
              "SELECT id FROM competitor_stores WHERE store_id = ? AND competitor_name = ?",
              [storeId, competitorName],
              (err, compResult) => {
                if (err || compResult.length === 0) {
                  console.error("❌ エラー: 競合店が見つかりません");
                  return res.status(400).json({ error: "競合店が見つかりません" });
                }
                const competitorId = compResult[0].id;

                const machineQuery = `
                  SELECT machine_name, quantity, updated_at
                  FROM machine_data
                  WHERE competitor_id = ? AND category_id = ?
                  AND DATE(updated_at) IN (?, ?)
                  ORDER BY updated_at DESC, quantity DESC
                `;

                const params = [competitorId, categoryId, ...targetDates];

                db.query(machineQuery, params, (err, results) => {
                  if (err) {
                    console.error("❌ 競合データ取得エラー:", err);
                    return res.status(500).json({ error: "データ取得エラー" });
                  }

                  const data1 = results.filter(row => row.updated_at.toISOString().startsWith(targetDates[0]));
                  const data2 = results.filter(row => row.updated_at.toISOString().startsWith(targetDates[1]));

                  res.json({
                    [targetDates[0]]: data1,
                    [targetDates[1]]: data2
                  });
                });
              }
            );
          }
        }
      );
    }
  );
});

// 📌すべての競合店の更新日時を取得するAPI
app.get("/get-all-latest-updates", (req, res) => {
  const { storeName } = req.query;

  if (!storeName) {
    return res.status(400).json({ error: "storeNameが指定されていません" });
  }

  // 自店IDを取得
  db.query("SELECT id FROM stores WHERE store_name = ?", [storeName], (err, storeResult) => {
    if (err || storeResult.length === 0) {
      console.error("❌ 自店が見つかりません");
      return res.status(400).json({ error: "自店が見つかりません" });
    }
    const storeId = storeResult[0].id;

    // 競合店一覧を取得
    db.query("SELECT id, competitor_name FROM competitor_stores WHERE store_id = ?", [storeId], (err, competitors) => {
      if (err) {
        console.error("❌ 競合店取得エラー:", err);
        return res.status(500).json({ error: "競合店取得エラー" });
      }

      const competitorIds = competitors.map(c => c.id);
      const competitorMap = new Map(competitors.map(c => [c.id, c.competitor_name]));

      const getCompetitorUpdates = () => {
        if (competitorIds.length === 0) return Promise.resolve([]);

        const placeholders = competitorIds.map(() => "?").join(",");
        const competitorQuery = `
          SELECT 
            md.competitor_id,
            md.category_id,
            c.category_name,
            MAX(md.updated_at) AS latest_update
          FROM machine_data md
          JOIN categories c ON md.category_id = c.id
          WHERE md.competitor_id IN (${placeholders})
          GROUP BY md.competitor_id, md.category_id
          ORDER BY md.competitor_id, c.sort_order
        `;
        return new Promise((resolve, reject) => {
          db.query(competitorQuery, competitorIds, (err, results) => {
            if (err) return reject(err);
            const formatted = results.map(row => ({
              competitor_id: row.competitor_id,
              competitor_name: competitorMap.get(row.competitor_id),
              category_id: row.category_id,
              category_name: row.category_name,
              latest_update: row.latest_update
            }));
            resolve(formatted);
          });
        });
      };

      const getOwnStoreUpdates = () => {
        const ownQuery = `
          SELECT 
            smd.category_id,
            c.category_name,
            MAX(smd.updated_at) AS latest_update
          FROM store_machine_data smd
          JOIN categories c ON smd.category_id = c.id
          WHERE smd.store_id = ?
          GROUP BY smd.category_id
          ORDER BY c.sort_order
        `;
        return new Promise((resolve, reject) => {
          db.query(ownQuery, [storeId], (err, results) => {
            if (err) return reject(err);
            const formatted = results.map(row => ({
              competitor_id: null, // 自店なのでnull
              competitor_name: storeName, // 自店名をセット
              category_id: row.category_id,
              category_name: row.category_name,
              latest_update: row.latest_update
            }));
            resolve(formatted);
          });
        });
      };

      Promise.all([getOwnStoreUpdates(), getCompetitorUpdates()])
        .then(([ownUpdates, competitorUpdates]) => {
          res.json([...ownUpdates, ...competitorUpdates]);
        })
        .catch(err => {
          console.error("❌ データ取得エラー:", err);
          res.status(500).json({ error: "データ取得エラー" });
        });
    });
  });
});

// ヘルスチェック用エンドポイント
app.get('/ping', (req, res) => {
  res.status(200).send('pong');
});

// 📦 Reactビルドファイルのパス指定
const buildPath = path.join(__dirname, "..", "client", "build");
app.use(express.static(buildPath));

// ✅ React用ルーティング（全てのGETリクエストにindex.htmlを返す）
app.get("*", (req, res) => {
  res.sendFile(path.join(buildPath, "index.html"));
});

// 📌 サーバー起動
app.listen(5000, () => {
  console.log("サーバーがポート5000で起動");
  // 起動直後に1回チェック
  checkDbConnection();
  // 5分ごとにDB接続チェック
  setInterval(checkDbConnection, CHECK_INTERVAL);
});

