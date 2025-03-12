require("dotenv").config(); // 環境変数を読み込む

const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
const axios = require("axios");

const app = express();
app.use(express.json());
app.use(cors());

// MySQL接続設定
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: "utf8mb4" // 日本語対応
});

const FASTAPI_URL = process.env.FASTAPI_URL || "http://localhost:8000";

// MySQL (TiDB) データベース接続設定
// const db = mysql.createPool({
//   host: process.env.DB_HOST,
//   user: process.env.DB_USER,
//   password: process.env.DB_PASSWORD,
//   database: process.env.DB_NAME,
//   port: process.env.DB_PORT || 4000,
//   ssl: { rejectUnauthorized: true }  
// });

// const FASTAPI_URL = process.env.FASTAPI_URL || "https://setchikishu-log-db-python.onrender.com";

// db.connect(err => {
//   if (err) {
//     console.error("MySQL接続エラー:", err);
//   } else {
//     console.log("MySQL接続成功");
//   }
// });

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
  const { storeName, competitorName, category, machines, isOwnStore } = req.body;

  db.query("SELECT id FROM stores WHERE store_name = ?", [storeName], (err, storeResult) => {
    if (err || storeResult.length === 0) {
      console.error("❌ エラー: 自店が見つかりません");
      return res.status(400).json({ error: "自店が見つかりません" });
    }
    const storeId = storeResult[0].id;

    db.query("SELECT id FROM categories WHERE category_name = ?", [category], (err, catResult) => {
      if (err || catResult.length === 0) {
        console.error("❌ エラー: カテゴリーが見つかりません");
        return res.status(400).json({ error: "カテゴリーが見つかりません" });
      }
      const categoryId = catResult[0].id;

      const totalQuantity = machines.reduce((sum, { quantity }) => sum + quantity, 0);
      console.log(`📊 総台数 (${category}): ${totalQuantity}`);

      if (isOwnStore) {
        checkAndInsert(
          storeId,
          "stores",
          totalQuantity,
          category,
          categoryId,
          machines,
          res,
          true  // ✅ isOwnStore
        );
      } else {
        db.query(
          "SELECT id FROM competitor_stores WHERE store_id = ? AND competitor_name = ?",
          [storeId, competitorName],
          (err, compResult) => {
            if (err || compResult.length === 0) {
              console.error("❌ エラー: 競合店が見つかりません");
              return res.status(400).json({ error: "競合店が見つかりません" });
            }
            const competitorId = compResult[0].id;
            checkAndInsert(
              competitorId,
              "competitor_stores",
              totalQuantity,
              category,
              categoryId,
              machines,
              res,
              false  // ✅ isOwnStore
            );
          }
        );
      }
    });
  });
});

function checkAndInsert(
  targetId,          // storeId or competitorId
  targetTable,       // "stores" or "competitor_stores"
  totalQuantity,
  category,
  categoryId,
  machines,
  res,
  isOwnStore        // ✅ 追加
) {
  const idColumn = "id"; // 両方idなので固定

  const checkQuery = `SELECT \`${category}\` AS currentTotal FROM ${targetTable} WHERE ${idColumn} = ?`;

  db.query(checkQuery, [targetId], (err, checkResult) => {
    if (err) {
      console.error("❌ 現在の総台数取得エラー:", err);
      return res.status(500).json({ error: "総台数取得エラー" });
    }

    const currentTotal = checkResult[0]?.currentTotal || 0;
    const difference = Math.abs(currentTotal - totalQuantity);

    if (difference >= 1) {
      return res.json({
        message: `総台数に差異があります (${currentTotal} → ${totalQuantity})。\n確認してください。`,
        needsTotalQuantityConfirmation: true,
        isOwnStore,
        targetId,  // storeId or competitorId
        category,
        categoryId,
        totalQuantity,
        machines,
      });
    }

    // ✅ insertOrUpdateMachineDataを呼び出し
    insertOrUpdateMachineData(
      targetId,
      category,
      categoryId,
      totalQuantity,
      machines,
      res,
      isOwnStore
    );
  });
}

// 📌 総台数確認後に登録作業を進めるAPI
app.post("/confirm-add-machine", (req, res) => {
  const { storeName, competitorName, category, machines, isOwnStore } = req.body;

  if (!storeName || !category || !machines || machines.length === 0) {
    console.error("❌ エラー: 必要なデータが不足しています");
    return res.status(400).json({ error: "必要なデータが不足しています" });
  }

  db.query("SELECT id FROM stores WHERE store_name = ?", [storeName], (err, storeResult) => {
    if (err || storeResult.length === 0) {
      console.error("❌ エラー: 自店が見つかりません");
      return res.status(400).json({ error: "自店が見つかりません" });
    }
    const storeId = storeResult[0].id;

    db.query("SELECT id FROM categories WHERE category_name = ?", [category], (err, catResult) => {
      if (err || catResult.length === 0) {
        console.error("❌ エラー: カテゴリーが見つかりません");
        return res.status(400).json({ error: "カテゴリーが見つかりません" });
      }
      const categoryId = catResult[0].id;

      const totalQuantity = machines.reduce((sum, { quantity }) => sum + quantity, 0);

      if (isOwnStore) {
        console.log("🛠 自店用登録処理:", { storeId, category, categoryId, totalQuantity, machines });
        insertOrUpdateMachineData(storeId, category, categoryId, totalQuantity, machines, res, true);
      } else {
        if (!competitorName) {
          console.error("❌ エラー: 競合店名がありません");
          return res.status(400).json({ error: "競合店名がありません" });
        }

        db.query("SELECT id FROM competitor_stores WHERE store_id = ? AND competitor_name = ?", 
          [storeId, competitorName], (err, compResult) => {
          if (err || compResult.length === 0) {
            console.error("❌ エラー: 競合店が見つかりません");
            return res.status(400).json({ error: "競合店が見つかりません" });
          }
          const competitorId = compResult[0].id;

          console.log("🛠 競合店用登録処理:", { competitorId, category, categoryId, totalQuantity, machines });
          insertOrUpdateMachineData(competitorId, category, categoryId, totalQuantity, machines, res, false);
        });
      }
    });
  });
});

// 📌 UIで確認後にデータを更新するAPI
app.post("/confirm-update-machine", (req, res) => {
  const {
    isOwnStore,
    targetId,  // storeId or competitorId
    category,
    categoryId,
    machines,
    machinesStage4,
    updatedAt
  } = req.body;

  if (!targetId || !category || !categoryId || !Array.isArray(machines) || !Array.isArray(machinesStage4)) {
    return res.status(400).json({ error: "必要なデータが不足しています" });
  }

  const targetTable = isOwnStore ? "store_machine_data" : "machine_data";
  const idColumn = isOwnStore ? "store_id" : "competitor_id";

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

  const updateMachineData = (inputName, name_collection_id, sis_code, updatedAt) => {
    return new Promise((resolve, reject) => {
      const updateSql = `
        UPDATE ${targetTable}
        SET name_collection_id = ?, sis_code = ?, updated_at = ?
        WHERE ${idColumn} = ? AND machine_name = ?
      `;
      db.query(updateSql, [name_collection_id, sis_code, updatedAt, targetId, inputName], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  };

  const processMachines = (machines) => {
    return machines.map(({ inputName, sis_code }) => {
      return insertNameCollection(inputName, sis_code)
        .then((name_collection_id) => updateMachineData(inputName, name_collection_id, sis_code, updatedAt));
    });
  };

  updatePromises.push(...processMachines(machines));
  updatePromises.push(...processMachines(machinesStage4));

  Promise.all(updatePromises)
    .then(() => {
      res.json({ message: "登録完了" });
    })
    .catch((err) => {
      console.error("❌ 更新エラー:", err);
      res.status(500).json({ error: "更新エラー" });
    });
});

// データを更新する関数**
function insertOrUpdateMachineData(
  targetId, // competitorId or storeId
  category,
  categoryId,
  totalQuantity,
  machines,
  res,
  isOwnStore // true: 自店, false: 競合
) {
  // const updatedAt = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const updatedAt = new Date().toISOString();

  const targetTable = isOwnStore ? "store_machine_data" : "machine_data";
  const totalUpdateTable = isOwnStore ? "stores" : "competitor_stores";
  const idColumn = isOwnStore ? "store_id" : "competitor_id";
  const responseIdKey = isOwnStore ? "storeId" : "competitorId";

  function basicNormalize(text) {
    return text
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
      .replace(/　/g, ' ')
      .replace(/[~〜～]/g, '')
      .replace(/[【】\[\]]/g, '')
      .replace(/[‐－ｰ\-]/g, '')
      .replace(/[\/／]/g, '')
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
      const query = `
        SELECT id, sis_code FROM name_collection 
        WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
          dotcom_machine_name, '-', ''), '‐', ''), '－', ''), ' ', ''), '　', ''), '~', ''), '〜', ''), '～', ''), '【', ''), '】', '') , '[', ''), ']', ''), '/', ''), '／', '')
        COLLATE utf8mb4_unicode_ci
        LIKE CONCAT('%', ?, '%')
        ORDER BY LENGTH(REGEXP_REPLACE(dotcom_machine_name, '【.*?】', '')) ASC 
        LIMIT 1
      `;

      db.query(query, [stage1Clean], (err, stage1Result) => {
        if (err) return reject(err);
        if (stage1Result.length > 0) 
          return resolve({
          inputName: originalName,
          name_collection_id: stage1Result[0].id,
          sis_code: stage1Result[0].sis_code,
          matchStage: 1,
          quantity
        });

        db.query(query, [stage2Clean], (err, stage2Result) => {
          if (err) return reject(err);
          if (stage2Result.length > 0) 
            return resolve({
              inputName: originalName,
              name_collection_id: stage2Result[0].id,
              sis_code: stage2Result[0].sis_code,
              matchStage: 2,
              quantity
            });

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
    const stage1And2 = results.filter(r => r.matchStage === 1 || r.matchStage === 2);
    const stage3 = results.filter(r => r.matchStage === 3);
    const stage4 = results.filter(r => r.matchStage === 4);

    const allConfirmedMachines = [...stage1And2, ...stage3, ...stage4];

    if (allConfirmedMachines.length > 0) {
      const values = allConfirmedMachines.map(({ inputName, name_collection_id, sis_code, quantity }) => [
        targetId, categoryId, inputName, name_collection_id || null, sis_code || null, quantity, updatedAt
      ]);

      db.query(`
        INSERT INTO ${targetTable} 
        (${idColumn}, category_id, machine_name, name_collection_id, sis_code, quantity, updated_at) 
        VALUES ? 
        ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), updated_at = VALUES(updated_at)
      `, [values], (err) => {
        if (err) {
          console.error("❌ データ登録エラー:", err);
          return res.status(500).json({ error: "データ登録エラー" });
        }
        console.log(`✅ ${targetTable} への登録成功`);
      });
    }

    const totalUpdateQuery = `UPDATE ${totalUpdateTable} SET \`${category}\` = ? WHERE id = ?`;
    db.query(totalUpdateQuery, [totalQuantity, targetId], (err) => {
      if (err) {
        console.error("❌ 総台数の更新エラー:", err);
        return res.status(500).json({ error: "総台数の更新エラー" });
      }
      console.log(`✅ 総台数 (${category}) を ${totalQuantity} に更新しました`);
    });

    const responseIdKey = isOwnStore ? "storeId" : "competitorId";
    const baseResponse = {
      message: "確認が必要なデータがあります",
      needsStage3Confirmation: stage3.length > 0,
      needsStage4Confirmation: stage4.length > 0,
      [responseIdKey]: targetId,
      category,
      categoryId,
      totalQuantity,
      machines: stage3,
      machinesStage4: stage4,
      updatedAt
    };

    const nameCollectionIds = stage3.map(r => r.name_collection_id).filter(id => id !== null);

    if (stage3.length === 0 && stage4.length === 0) {
      return res.json({
        message: "登録完了（ステージ3・4の確認は不要）",
        [responseIdKey]: targetId,
        category,
        categoryId,
        totalQuantity,
        updatedAt
      });
    }

    if (nameCollectionIds.length > 0) {
      db.query(`SELECT id, sis_code FROM name_collection WHERE id IN (?)`, [nameCollectionIds], (err, sisCodeResults) => {
        if (err) {
          console.error("❌ name_collection から sis_code の取得エラー:", err);
          return res.status(500).json({ error: "sis_code の取得エラー" });
        }

        const sisCodes = sisCodeResults.map(row => row.sis_code).filter(code => code !== null);

        if (sisCodes.length === 0) {
          console.log("❌ name_collection から取得した sis_code が空です");
          return res.json({ ...baseResponse, machineDetails: [] });
        }

        db.query(`
          SELECT sis_machine_code, sis_type_code, cr_category, sis_maker_code, sis_machine_name
          FROM sis_machine_data
          WHERE sis_machine_code IN (?)
        `, [sisCodes], (err, machineDetails) => {
          if (err) {
            console.error("❌ sis_machine_data の取得エラー:", err);
            return res.status(500).json({ error: "機種情報取得エラー" });
          }

          console.log(`🛠 ${targetTable} で送るデータ:`, {
            ...baseResponse,
            machineDetails
          });

          return res.json({ ...baseResponse, machineDetails });
        });
      });
    } else {
      return res.json({ ...baseResponse, machineDetails: [] });
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
// app.get("/get-machines-by-dates", (req, res) => {
//   const { storeName, competitorName, category, date1, date2 } = req.query;

//   db.query(
//     "SELECT id FROM stores WHERE store_name = ?",
//     [storeName],
//     (err, storeResult) => {
//       if (err || storeResult.length === 0) {
//         console.error("❌ エラー: 自店が見つかりません", err);
//         return res.status(400).json({ error: "自店が見つかりません" });
//       }
//       const storeId = storeResult[0].id;

//       db.query(
//         "SELECT id FROM categories WHERE category_name = ?",
//         [category],
//         (err, catResult) => {
//           if (err || catResult.length === 0) {
//             console.error("❌ エラー: カテゴリーが見つかりません", err);
//             return res.status(400).json({ error: "カテゴリーが見つかりません" });
//           }
//           const categoryId = catResult[0].id;

//           const isOwnStore = competitorName === "self"; // ✅ 自店判定

//           if (isOwnStore) {
//             // ✅ 自店のデータを取得
//             console.log("🔍 自店のデータ取得:", { storeId, categoryId, date1, date2 });

//             const machineQuery = `
//               SELECT machine_name, quantity, updated_at
//               FROM store_machine_data
//               WHERE store_id = ? AND category_id = ?
//               AND updated_at IN (?, ?)
//               ORDER BY updated_at DESC, quantity DESC
//             `;

//             db.query(
//               machineQuery,
//               [storeId, categoryId, date1, date2],
//               (err, results) => {
//                 if (err) {
//                   console.error("❌ データ取得エラー:", err);
//                   return res.status(500).json({ error: "データ取得エラー" });
//                 }

//                 const date1ISO = new Date(date1).toISOString();
//                 const date2ISO = new Date(date2).toISOString();

//                 const date1Data = results.filter(row => row.updated_at.toISOString() === date1ISO);
//                 const date2Data = results.filter(row => row.updated_at.toISOString() === date2ISO);

//                 res.json({
//                   date1: date1Data,
//                   date2: date2Data
//                 });
//               }
//             );
//           } else {
//             // ✅ 競合店のデータを取得
//             db.query(
//               "SELECT id FROM competitor_stores WHERE store_id = ? AND competitor_name = ?",
//               [storeId, competitorName],
//               (err, compResult) => {
//                 if (err || compResult.length === 0) {
//                   console.error("❌ エラー: 競合店が見つかりません", err);
//                   return res.status(400).json({ error: "競合店が見つかりません" });
//                 }
//                 const competitorId = compResult[0].id;

//                 console.log("🔍 競合店のデータ取得:", { competitorId, categoryId, date1, date2 });

//                 const machineQuery = `
//                   SELECT machine_name, quantity, updated_at
//                   FROM machine_data
//                   WHERE competitor_id = ? AND category_id = ?
//                   AND updated_at IN (?, ?)
//                   ORDER BY updated_at DESC, quantity DESC
//                 `;

//                 db.query(
//                   machineQuery,
//                   [competitorId, categoryId, date1, date2],
//                   (err, results) => {
//                     if (err) {
//                       console.error("❌ データ取得エラー:", err);
//                       return res.status(500).json({ error: "データ取得エラー" });
//                     }

//                     const date1ISO = new Date(date1).toISOString();
//                     const date2ISO = new Date(date2).toISOString();

//                     const date1Data = results.filter(row => row.updated_at.toISOString() === date1ISO);
//                     const date2Data = results.filter(row => row.updated_at.toISOString() === date2ISO);

//                     res.json({
//                       date1: date1Data,
//                       date2: date2Data
//                     });
//                   }
//                 );
//               }
//             );
//           }
//         }
//       );
//     }
//   );
// });

app.get("/get-machines-by-dates", (req, res) => {
  const { storeName, competitorName, category, date1, date2 } = req.query;

  db.query(
    "SELECT id FROM stores WHERE store_name = ?",
    [storeName],
    (err, storeResult) => {
      if (err || storeResult.length === 0) {
        console.error("❌ エラー: 自店が見つかりません", err);
        return res.status(400).json({ error: "自店が見つかりません" });
      }
      const storeId = storeResult[0].id;

      db.query(
        "SELECT id FROM categories WHERE category_name = ?",
        [category],
        (err, catResult) => {
          if (err || catResult.length === 0) {
            console.error("❌ エラー: カテゴリーが見つかりません", err);
            return res.status(400).json({ error: "カテゴリーが見つかりません" });
          }
          const categoryId = catResult[0].id;

          const isOwnStore = competitorName === "self"; // ✅ 自店判定

          if (isOwnStore) {
            console.log("🔍 自店のデータ取得:", { storeId, categoryId, date1, date2 });

            const date1UTC = new Date(date1).toISOString();
            const date2UTC = new Date(date2).toISOString();
            console.log("🕒 UTC形式:", { date1UTC, date2UTC });

            const machineQuery = `
              SELECT machine_name, quantity, updated_at
              FROM store_machine_data
              WHERE store_id = ? AND category_id = ?
              AND (DATE(updated_at) = DATE(?) OR DATE(updated_at) = DATE(?))
              ORDER BY updated_at DESC, quantity DESC
            `;

            db.query(
              machineQuery,
              [storeId, categoryId, date1UTC, date2UTC],
              (err, results) => {
                if (err) {
                  console.error("❌ データ取得エラー:", err);
                  return res.status(500).json({ error: "データ取得エラー" });
                }

                console.log("📊 検索結果:", results.length, "件ヒット");

                const date1Data = results.filter(row => new Date(row.updated_at).toISOString().split("T")[0] === date1UTC.split("T")[0]);
                const date2Data = results.filter(row => new Date(row.updated_at).toISOString().split("T")[0] === date2UTC.split("T")[0]);

                res.json({
                  date1: date1Data,
                  date2: date2Data
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

// 📌 サーバー起動
app.listen(5000, () => {
  console.log("サーバーがポート5000で起動");
  // 起動直後に1回チェック
  checkDbConnection();
  // 5分ごとにDB接続チェック
  setInterval(checkDbConnection, CHECK_INTERVAL);
});

