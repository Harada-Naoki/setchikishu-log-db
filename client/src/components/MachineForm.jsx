import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Modal from "react-modal";
import axios from "axios";
import "../css/MachineForm.css";
import HamburgerMenu from './HamburgerMenu';

Modal.setAppElement("#root");

function MachineForm() {
  const { storeName } = useParams();
  const [selectedStore, setSelectedStore] = useState("");
  const [competitors, setCompetitors] = useState([]);
  const [selectedCompetitor, setSelectedCompetitor] = useState("");
  const [type, setType] = useState("");
  const [machineData, setMachineData] = useState("");
  const [newCompetitor, setNewCompetitor] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false); 
  const [machineSearchResults, setMachineSearchResults] = useState([]); // 🔹 機種検索結果を管理
  const [machineType, setMachineType] = useState(""); // パチンコ or スロット
  const [makers, setMakers] = useState([]); // メーカーリスト
  const [selectedMaker, setSelectedMaker] = useState(""); // 選択したメーカー
  const [types, setTypes] = useState([]); // 機種タイプリスト
  const [selectedType, setSelectedType] = useState(""); // 選択した機種タイプ
  const [machineName, setMachineName] = useState(""); // 🔹 検索用の機種名
  const [searchingMachine, setSearchingMachine] = useState(null);
  const [latestUpdates, setLatestUpdates] = useState([]);
  const isOwnStore = selectedCompetitor === "self";

  const [pendingTotalConfirmation, setPendingTotalConfirmation] = useState([]); // 🔹 総台数確認データ
  const [showTotalConfirmationModal, setShowTotalConfirmationModal] = useState(false); // 🔹 モーダルの表示状態

  const [missingMachines, setMissingMachines] = useState([]); // 🔹 総台数確認データ
  const [showMissingMachineModal, setShowMissingMachineModal] = useState(false); // 🔹 モーダルの表示状態


  const API_URL = process.env.REACT_APP_API_URL;

  /** 🔹 自店名を取得 */
  useEffect(() => {
    if (storeName) {
      setSelectedStore(decodeURIComponent(storeName));
    }
  }, [storeName]);

  /** 🔹 競合店リストを取得 */
  useEffect(() => {
    if (!API_URL || !selectedStore) return;

    fetch(`${API_URL}/get-stores`)
      .then(res => res.json())
      .then(data => {
        const store = data.find(s => s.name === selectedStore);
        setCompetitors(store ? store.competitors : []);
      })
      .catch(err => console.error("エラー:", err));
  }, [API_URL, selectedStore]);

   // 🔹 Sisメーカーリスト取得
  useEffect(() => {
    axios.get(`${API_URL}/get-sis-makers`)
      .then(response => setMakers(response.data))
      .catch(error => console.error("メーカー取得エラー:", error));
  }, []);

  // 🔹 Sis機種タイプリスト取得
  useEffect(() => {
    axios.get(`${API_URL}/get-sis-types`)
      .then(response => setTypes(response.data))
      .catch(error => console.error("機種タイプ取得エラー:", error));
  }, []);

  /** 🔹 機種データをパース */
  const parseMachineData = () => {
    if (!machineData) {
        console.warn("⚠️ 入力されたデータが空です");
        return [];
    }

    // 🔹 `textarea` の中身（HTML文字列）を DOM としてパース
    const parser = new DOMParser().parseFromString(machineData, "text/html");
    const container = parser.querySelector("#hall_kisyus");

    if (!container) {
        console.warn("⚠️ `#hall_kisyus` が見つかりません。HTMLの構造を確認してください。");
        console.log("🔍 現在の `machineData`:", machineData);
        return [];
    }

    // 🔹 `section` 要素を取得（パチンコ & スロット）
    const sections = container.querySelectorAll("section");
    if (sections.length === 0) {
        console.warn("⚠️ セクションが見つかりません。HTMLの構造が変わっている可能性があります。");
        return [];
    }

    let machines = [];

    // 🔹 レートマッピング（パチンコとスロットを分離）
    const rateMapping = {
        "パチンコ": [
            { min: 3.5, max: 4.5, category: "4円パチンコ" },
            { min: 1.5, max: 3.49, category: "2円パチンコ" },
            { min: 1, max: 1.49, category: "1円パチンコ" },
            { min: 0, max: 0.99, category: "1円未満パチンコ" }
        ],
        "スロット": [
            { min: 15, max: 24, category: "20円スロット" },
            { min: 9, max: 14.99, category: "10円スロット" },
            { min: 5, max: 8.99, category: "5円スロット" },
            { min: 0, max: 4.99, category: "5円未満スロット" }
        ]
    };

    // 🔹 レートの分類関数
    const classifyRate = (rateText, type) => {
        const value = eval(rateText.replace("円", "").replace("玉", "").replace("枚", "").replace("/", "/"));
        const category = rateMapping[type]?.find(r => value >= r.min && value <= r.max);
        return category ? category.category : "不明";
    };

    sections.forEach(section => {
        const type = section.id === "pachi" ? "パチンコ" : "スロット"; // 🔹 種別（パチ or スロ）

        // 🔹 カテゴリー情報を取得
        const categoryTitles = section.querySelectorAll(".hallKisyuList-categoryTitle");

        categoryTitles.forEach(category => {
            const rateText = category.getAttribute("data-machine-rate");
            const categoryName = classifyRate(rateText, type); // 🔹 機種種別に応じたレート分類

            let nextMachine = category.nextElementSibling;
            while (nextMachine && nextMachine.classList.contains("js-hallKisyuList-item")) {
                const machineNames = nextMachine.getAttribute("data-machine-name").split(",");
                const machineNameElement = nextMachine.querySelector(".hallKisyuList-machineName");
                const machineName = machineNameElement ? machineNameElement.textContent.trim() : machineNames[0].trim();
                const quantityText = nextMachine.querySelector(".hallKisyuList-count")?.textContent.trim();
                const quantity = quantityText ? parseInt(quantityText, 10) : null;

                machines.push({
                    type,       // 🔹 パチンコ or スロット
                    rate: eval(rateText.replace("円", "").replace("玉", "").replace("枚", "").replace("/", "/")), // 🔹 計算されたレート
                    category: categoryName, // 🔹 統合後のカテゴリー (例: "4円パチンコ")
                    machine: machineName,  // 🔹 表示される機種名
                    quantity,   // 🔹 台数
                    aliases: machineNames.map(name => name.trim()), // 🔹 別名リスト
                });

                nextMachine = nextMachine.nextElementSibling;
            }
        });
    });

    console.log("✅ パース完了:", machines);
    return machines;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);

    const machines = parseMachineData(); 

    if (!selectedCompetitor || machines.length === 0) {
        alert("すべての項目を入力してください");
        setIsLoading(false);
        return;
    }

    const groupedMachines = machines.reduce((acc, { category, machine, quantity, aliases }) => {
        if (!acc[category]) acc[category] = [];
        acc[category].push({ machine, quantity, aliases });
        return acc;
    }, {});

    const payload = {
        storeName: selectedStore,
        competitorName: isOwnStore ? null : selectedCompetitor,
        categories: Object.entries(groupedMachines).map(([category, machines]) => ({
            category,
            machines
        })),
        isOwnStore
    };

    console.log("🚀 送信データ:", payload);

    try {
        const response = await fetch(`${API_URL}/add-machine`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        let data = await response.json();
        console.log("🛠 受信したデータ:", data);

        if (!response.ok) {
            alert(`登録に失敗しました: ${data.error}`);
            return;
        }

        // ✅ **総台数の確認が必要かチェック**
        if (data.message?.includes("総台数に差異があります")) {
            console.warn("⚠️ 総台数に差異があります。フロントエンドで確認を求めます。");

            // **確認用データをセットしてモーダルを開く**
            setPendingTotalConfirmation(data.categories);
            setShowTotalConfirmationModal(true);
            return; 
        }

        // ✅ **`missingSisCodes` がある場合、手動入力モーダルを開く**
        if (data.missingSisCodes && data.missingSisCodes.length > 0) {
            console.warn("⚠️ 一部の `sis_code` が見つからず、手動入力が必要:", data.missingSisCodes);
            setMissingMachines(data.missingSisCodes);
            setShowMissingMachineModal(true);
            return;
        }

        alert("✅ すべてのデータが正常に登録されました！");
        resetForm();

    } catch (error) {
        console.error("❌ エラー:", error);
        alert("エラーが発生しました");
    } finally {
        setIsLoading(false);
    }
  };

  // ⚠️ モーダルを作成し、確認後 `/confirm-insert` を呼び出す
  const handleTotalConfirmation = async () => {
    if (!pendingTotalConfirmation) return; // 🔹 確認データがない場合は処理しない

    setIsLoading(true);
    try {
        const confirmedResponse = await fetch(`${API_URL}/confirm-insert`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                storeName: selectedStore,
                competitorName: isOwnStore ? null : selectedCompetitor,
                categories: pendingTotalConfirmation.map(category => ({
                    ...category,
                    totalQuantity: category.totalQuantity // 🔹 追加
                })),
                isOwnStore
            }),
        });

        const confirmedData = await confirmedResponse.json();

        if (!confirmedResponse.ok) {
            alert(`登録に失敗しました: ${confirmedData.error}`);
            return;
        }

        // ✅ **`missingSisCodes` がある場合、手動入力モーダルを開く**
        if (confirmedData.missingSisCodes && confirmedData.missingSisCodes.length > 0) {
            console.warn("⚠️ 一部の `sis_code` が見つからず、手動入力が必要:", confirmedData.missingSisCodes);
            setMissingMachines(confirmedData.missingSisCodes);
            setShowMissingMachineModal(true);
            return;
        }

        alert("✅ すべてのデータが正常に登録されました！");
        resetForm();

    } catch (error) {
        console.error("❌ 確認エラー:", error);
        alert("エラーが発生しました");
    } finally {
        setIsLoading(false);
        setShowTotalConfirmationModal(false);
    }
  };

  /** 🔹 フォームリセット関数 */
  const resetForm = () => {
    setMachineData("");
    setSearchingMachine(null);
    if (selectedCompetitor) {
      handleCompetitorChange({ target: { value: selectedCompetitor } });
    }
  };

  /** 🔹 キャンセル用リセット関数 */
  const resetModal = () => {
    setShowMissingMachineModal(false);
    setSearchingMachine(null);
    if (selectedCompetitor) {
      handleCompetitorChange({ target: { value: selectedCompetitor } });
    }
  };

  /** 🔹 競合店を追加する */
  const handleAddCompetitor = async () => {
    if (!newCompetitor) {
      alert("競合店名を入力してください");
      return;
    }

    try {
      const response = await fetch(`${API_URL}/add-competitor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeName: selectedStore, competitorName: newCompetitor }),
      });

      if (response.ok) {
        alert("競合店が追加されました！");
        setCompetitors([...competitors, newCompetitor].sort((a, b) => a.localeCompare(b, "ja")));
        setNewCompetitor("");
        setShowAddForm(false);
        setSelectedCompetitor(newCompetitor);
      } else {
        alert("競合店の追加に失敗しました");
      }
    } catch (error) {
      console.error("Error:", error);
      alert("エラーが発生しました");
    }
  };

  /** 🔹 競合店選択の処理 */
  const handleCompetitorChange = (e) => {
    const value = e.target.value;
  
    if (value === "add-new") {
      setShowAddForm(true);
      setSelectedCompetitor("");
      setLatestUpdates([]); // 追加モードでは最新更新日リセット
    } else if (value === "self") {
      // ✅ 自店の場合
      setSelectedCompetitor("self");
      setShowAddForm(false);
  
      fetch(`${API_URL}/get-latest-updates?storeName=${storeName}&competitorName=self`)
        .then(res => res.json())
        .then(data => {
          console.log("✅ 自店の最新更新日時取得:", data);
          setLatestUpdates(data);
        })
        .catch(err => {
          console.error("❌ 自店の最新更新日時取得エラー:", err);
          setLatestUpdates([]);
        });
    } else {
      // ✅ 競合店の場合
      setSelectedCompetitor(value);
      setShowAddForm(false);
  
      fetch(`${API_URL}/get-latest-updates?storeName=${storeName}&competitorName=${value}`)
        .then(res => res.json())
        .then(data => {
          console.log("✅ 競合店の最新更新日時取得:", data);
          setLatestUpdates(data);
        })
        .catch(err => {
          console.error("❌ 競合店の最新更新日時取得エラー:", err);
          setLatestUpdates([]);
        });
    }
  };  
  
  /** 🔹 一覧画面へ遷移 */
  const handleNavigate = () => {
    if (!selectedCompetitor || !type) {
      const encodedStore = encodeURIComponent(selectedStore);
      navigate(`/machines/${encodedStore}`);
      return;
    }
    const encodedStore = encodeURIComponent(selectedStore);
    const encodedCompetitor = encodeURIComponent(selectedCompetitor);
    const encodedType = encodeURIComponent(type);
  
    navigate(`/machines/${encodedStore}?competitor=${encodedCompetitor}&type=${encodedType}`);
  };
  
  // 🔹 機種検索
  const fetchMachines = async () => {
    if (!machineType) {
      alert("種別（パチンコ or スロット）を選択してください");
      return;
    }

    const params = {
      category: machineType === "pachinko" ? 1 : machineType === "slot" ? 2 : undefined,
      maker: selectedMaker || undefined,
      type: selectedType || undefined,
      machineName: machineName || undefined,
    };

    try {
      const response = await axios.get(`${API_URL}/get-sis-machines`, { params });
      setMachineSearchResults(response.data);
    } catch (error) {
      console.error("機種検索エラー:", error);
      alert("機種の検索に失敗しました");
    }
  };

   // 🔹 修正対象を設定
  const handleEditMachine = (idx, machine) => {
    setSearchingMachine(machine);
    setMachineName(""); // 検索用フィールドをリセット
    setMachineSearchResults([]);
  };

  // 🔹 検索結果から修正確定
  const applyFixedMachine = (selectedMachine) => {
    console.log("🔹 修正前の missingMachines:", missingMachines);

    const updatedMachines = missingMachines.map(m =>
        m.machine === searchingMachine.machine
            ? { ...m, sis_code: selectedMachine.sis_machine_code, fixedName: selectedMachine.sis_machine_name }
            : m
    );

    console.log("✅ 修正後の missingMachines:", updatedMachines);

    setMissingMachines(updatedMachines);
    setSearchingMachine(null); // 検索フォームを閉じる
  };

  // 🔹 すべての機種が確定されたか判定
  const isAllConfirmed = () => {
    if (!missingMachines) return false;
    return missingMachines.every(m => m.fixedName && m.fixedName.trim() !== "");
  };

  /** 🔹 確認後の更新処理 */
  const handleConfirmUpdate = async () => {
    if (!missingMachines) {
        alert("確認するデータがありません");
        return;
    }

    console.log("🛠 `handleConfirmUpdate` に送るデータ:", missingMachines);

    try {
        const confirmResponse = await fetch(`${API_URL}/update-missing-sis-code`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ machines: missingMachines, isOwnStore}),
        });

        const confirmData = await confirmResponse.json();

        if (confirmResponse.ok) {
            alert("データが登録されました！");
            setShowMissingMachineModal(false);
            setMissingMachines(null);
            resetForm();
        } else {
            alert(`登録に失敗しました: ${confirmData.error}`);
        }
    } catch (error) {
        console.error("❌ 更新エラー:", error);
        alert("エラーが発生しました");
    }
  };

  return (
    <div className="container">
      <HamburgerMenu storeName={storeName} />
      <h2>設置機種登録 - {selectedStore}</h2>
      {isLoading && <p className="loading-text">データ登録中...</p>}
      <form className="machine-form" onSubmit={handleSubmit}>
        <label>登録する店舗を選択:</label>
        <select value={selectedCompetitor} onChange={handleCompetitorChange}>
          <option value="">選択してください</option>

          {/* 自店名を追加 */}
          {selectedStore && (
            <option value={"self"}>【自店】{selectedStore}</option>
          )}

          {/* 競合店舗のリスト */}
          {competitors.map((store) => (
            <option key={store} value={store}>
              {store}
            </option>
          ))}

          <option value="add-new">+ 競合店を追加</option>
        </select>

         {/* 競合店追加フォーム（選択時のみ表示） */}
        {showAddForm && (
          <div className="add-competitor">
            <input
              type="text"
              value={newCompetitor}
              onChange={(e) => setNewCompetitor(e.target.value)}
              placeholder="例: ○○店"
            />
            <button type="button" onClick={handleAddCompetitor}>追加</button>
          </div>
        )}

        {latestUpdates.length > 0 && (
          <div className="latest-updates">
            <label>最新更新日</label>
            <ul>
              {latestUpdates.map(update => {
                const updatedDate = new Date(update.latest_update);
                const now = new Date();
                const oneWeekAgo = new Date();
                oneWeekAgo.setDate(now.getDate() - 7);

                const isOld = updatedDate < oneWeekAgo;

                return (
                  <li
                    key={update.category_id}
                    style={{ color: isOld ? "red" : "inherit" }}
                  >
                    {update.category_name}: {updatedDate.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <label>機種名 & 台数:</label>
        <textarea 
          className="machine-textarea" 
          value={machineData} 
          onChange={(e) => setMachineData(e.target.value)} 
          disabled={isLoading}
          maxLength={undefined} // これにより上限なしになる
        />

        <button type="submit" className="submit-btn" disabled={isLoading}>
          {isLoading ? "処理中..." : "登録"}
        </button>
      </form>

      <Modal 
        isOpen={showMissingMachineModal}
        onRequestClose={() => setShowMissingMachineModal(false)}
        shouldCloseOnOverlayClick={false}
        shouldCloseOnEsc={false}
        contentLabel="機種データ確認"
        className="modal"
        overlayClassName="overlay"
    >
        <h2>機種データの確認</h2>

        {/* 🔹 `sis_code` が見つからなかった機種の修正 */}
        {missingMachines?.length > 0 && (
            <>
                <h3>該当機種が見つかりませんでした(要修正)</h3>
                <table>
                    <thead>
                        <tr>
                            <th>入力された機種名</th>
                            <th>修正後の機種名</th>
                            <th>台数</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {missingMachines.map((m, idx) => (
                            <tr key={idx}>
                                <td>{m.machine}</td>
                                <td>{m.fixedName || "未修正"}</td>
                                <td>{m.quantity}</td>
                                <td>
                                    <button onClick={() => handleEditMachine(idx, m)}>修正</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </>
        )}

        {/* 🔹 検索フォーム（修正時のみ表示） */}
        {searchingMachine !== null && (
            <>
                <h3>修正対象: {searchingMachine.machine}</h3>

                <div className="search-form">
                    <div className="search-form-row">
                        <label>種別:</label>
                        <select value={machineType} onChange={(e) => setMachineType(e.target.value)}>
                            <option value="">選択してください</option>
                            <option value="pachinko">パチンコ</option>
                            <option value="slot">スロット</option>
                        </select>
                    </div>

                    <div className="search-form-row">
                        <label>メーカー:</label>
                        <select value={selectedMaker} onChange={(e) => setSelectedMaker(e.target.value)}>
                            <option value="">すべてのメーカー</option>
                            {makers.map(maker => (
                                <option key={maker.sis_maker_code} value={maker.sis_maker_code}>
                                    {maker.sis_maker_name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="search-form-row">
                        <label>機種タイプ:</label>
                        <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)}>
                            <option value="">すべての機種タイプ</option>
                            {types.map(type => (
                                <option key={type.sis_type_code} value={type.sis_type_code}>
                                    {type.sis_type_name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="search-form-row">
                        <label>機種名検索:</label>
                        <input
                            type="text"
                            placeholder="例: ガンダム"
                            value={machineName}
                            onChange={(e) => setMachineName(e.target.value)}
                        />
                    </div>

                    <button onClick={fetchMachines}>検索</button>
                </div>

                {machineSearchResults.length > 0 && (
                    <div className="search-results">
                        <h4>検索結果</h4>
                        <ul>
                            {machineSearchResults.map((machine, index) => (
                                <li key={index}>
                                    <a 
                                        href={`https://www.google.com/search?q=${encodeURIComponent(machine.sis_machine_name)}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ color: "#007bff", textDecoration: "underline" }}
                                    >
                                        {machine.sis_machine_name}
                                    </a>
                                    <button onClick={() => applyFixedMachine(machine)}>選択</button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </>
        )}

        {/* 🔹 確定ボタン */}
        <button
            className="confirm-button"
            onClick={handleConfirmUpdate}
            disabled={!isAllConfirmed()}
        >
            確定する
        </button>

        <button
          onClick={() => {
            const confirmCancel = window.confirm("本当にキャンセルしますか？\n入力した内容は失われます。");
            if (confirmCancel) {
              resetForm();
              resetModal();
            }
          }}
        >
          キャンセル
        </button>
    </Modal>

      {showTotalConfirmationModal && (
        <div className="modal">
          <div className="modal-content">
            <h3>⚠️ 総台数に差異があります</h3>
            <p>登録を続行しますか？</p>
            <ul>
              {pendingTotalConfirmation.map((c, index) => (
                <li key={index}>
                  {c.category}: {c.currentTotal} → {c.totalQuantity}
                </li>
              ))}
            </ul>
            <button onClick={handleTotalConfirmation}>OK</button>
            <button onClick={() => setShowTotalConfirmationModal(false)}>キャンセル</button>
          </div>
        </div>
      )}

      <div className="button-container">
        <div className="button-box" onClick={handleNavigate}>
          <div className="icon">
            📋
          </div>
          <h3>設置機種一覧へ</h3>
          <p>登録済みの設置機種一覧を確認・編集する画面に移動します。</p>
        </div>

        <div className="button-box" onClick={() => navigate(`/updates/${encodeURIComponent(storeName)}`)}>
          <div className="icon">
            🔄
          </div>
          <h3>更新情報一覧へ</h3>
          <p>競合店のカテゴリごとの最新更新状況を確認する画面に移動します。</p>
        </div>
      </div>
      <button
        className="navigate-btn"
        onClick={() => navigate(`/select-store`)}
      >
        Topへ
      </button>
    </div>
  );
}

export default MachineForm;
