import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Modal from "react-modal";
import axios from "axios";
import "../css/MachineForm.css";

Modal.setAppElement("#root");

function MachineForm() {
  const { storeName } = useParams();
  const [selectedStore, setSelectedStore] = useState("");
  const [competitors, setCompetitors] = useState([]);
  const [typeOptions, setTypeOptions] = useState([]);
  const [selectedCompetitor, setSelectedCompetitor] = useState("");
  const [type, setType] = useState("");
  const [machineData, setMachineData] = useState("");
  const [newCompetitor, setNewCompetitor] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState(null);
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false); 
  const [searchingIndex, setSearchingIndex] = useState(null); // 🔹 修正対象の行
  const [searchingStage, setSearchingStage] = useState(null); // 🔹 ステージ3 or 4
  const [machineSearchResults, setMachineSearchResults] = useState([]); // 🔹 機種検索結果を管理
  const [machineType, setMachineType] = useState(""); // パチンコ or スロット
  const [makers, setMakers] = useState([]); // メーカーリスト
  const [selectedMaker, setSelectedMaker] = useState(""); // 選択したメーカー
  const [types, setTypes] = useState([]); // 機種タイプリスト
  const [selectedType, setSelectedType] = useState(""); // 選択した機種タイプ
  const [machineName, setMachineName] = useState(""); // 🔹 検索用の機種名
  const [confirmedMachines, setConfirmedMachines] = useState(new Set()); // 🔹 確定済みの機種管理
  const [searchingMachine, setSearchingMachine] = useState(null);
  const [pachinkoTypes, setPachinkoTypes] = useState([]);
  const [slotTypes, setSlotTypes] = useState([]);
  const [latestUpdates, setLatestUpdates] = useState([]);
  const isOwnStore = selectedCompetitor === "self";



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

  /** 🔹 種別リストを取得 */
  useEffect(() => {
    if (!API_URL) return;
  
    fetch(`${API_URL}/get-types`)
      .then(res => res.json())
      .then(data => {
        setTypeOptions(data);
        setPachinkoTypes(data.slice(0, 4));
        setSlotTypes(data.slice(4, 8));
      })
      .catch(err => console.error("エラー:", err));
  }, [API_URL]);

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
    const lines = machineData.split("\n").map(line => line.trim()).filter(Boolean);
    let machines = [];
    let previousLine = "";

    lines.forEach(line => {
      if (/^\d+$/.test(line)) {
        const quantity = parseInt(line, 10);
        if (previousLine) {
          machines.push({ machine: previousLine, quantity });
        }
      } else if (!line.match(/【.*】/)) {
        previousLine = line;
      }
    });

    return machines;
  };

  /** 🔹 機種データを登録 */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true); 
    const machines = parseMachineData();
  
    if (!selectedCompetitor || !type || machines.length === 0) {
      alert("すべての項目を入力してください");
      setIsLoading(false);
      return;
    }
  
    const payload = {
      storeName: selectedStore,
      competitorName: isOwnStore ? null : selectedCompetitor,
      category: type,
      machines,
      isOwnStore
    };

    console.log("✅ 送信データ:", payload); 
  
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
  
      // ✅ **総台数の確認**
      if (data.needsTotalQuantityConfirmation) {
        const confirmMessage = `総台数に差異があります (${data.currentTotal} → ${data.totalQuantity})。\n登録を続行しますか？`;
        const userConfirmed = window.confirm(confirmMessage);
  
        if (!userConfirmed) {
          alert("登録をキャンセルしました。");
          return;
        }
  
        const confirmedResponse = await fetch(`${API_URL}/confirm-add-machine`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
  
        const confirmedData = await confirmedResponse.json();
  
        if (!confirmedResponse.ok) {
          alert(`登録に失敗しました: ${confirmedData.error}`);
          return;
        }
  
        data = confirmedData; // **Stage3 の確認用にデータ更新**
      }
  
      // ✅ **Stage3 の `Modal` を開く**
      if (data.needsStage3Confirmation || data.needsStage4Confirmation) {
        setConfirmedMachines(new Set());
        setPendingConfirmation(data);
        setShowConfirmationModal(true);
      } else {
        alert("データが登録されました！");
        resetForm();
      }
    } catch (error) {
      console.error("Error:", error);
      alert("エラーが発生しました");
    } finally {
      setIsLoading(false); // **🔹 ローディング終了**
    }
  };  

  /** 🔹 フォームリセット関数 */
  const resetForm = () => {
    setMachineData("");
    setShowConfirmationModal(false);
    setSearchingMachine(null);
    setSearchingIndex(null);
    setSearchingStage(null);
    if (selectedCompetitor) {
      handleCompetitorChange({ target: { value: selectedCompetitor } });
    }
  };

  /** 🔹 キャンセル用リセット関数 */
  const resetModal = () => {
    setShowConfirmationModal(false);
    setSearchingMachine(null);
    setSearchingIndex(null);
    setSearchingStage(null);
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
  const handleEditMachine = (stage, idx, machine) => {
    setSearchingIndex(idx);
    setSearchingStage(stage);
    setSearchingMachine(machine);
    setMachineName(""); // 検索用フィールドをリセット
    setMachineSearchResults([]);
  };

  // 🔹 検索結果から修正確定
  const applyFixedMachine = (selectedMachine) => {
    // 更新前のデータをログ出力
    console.log("🔹 修正前の pendingConfirmation:", pendingConfirmation);

    const updatedConfirmation = { ...pendingConfirmation };

    if (searchingStage === 3) {
      updatedConfirmation.machines[searchingIndex] = {
        ...updatedConfirmation.machines[searchingIndex],
        name_collection_id: selectedMachine.id,
        sis_code: selectedMachine.sis_machine_code,
        fixedName: selectedMachine.sis_machine_name,
        isFixed: true, 
      };
    } else if (searchingStage === 4) {
      updatedConfirmation.machinesStage4[searchingIndex] = {
        ...updatedConfirmation.machinesStage4[searchingIndex],
        name_collection_id: selectedMachine.id,
        sis_code: selectedMachine.sis_machine_code,
        fixedName: selectedMachine.sis_machine_name, 
      };
    }

    // 更新後のデータをログ出力
    console.log("✅ 修正後の pendingConfirmation:", updatedConfirmation);

    // 状態を更新
    setPendingConfirmation(updatedConfirmation);

    // ステートをクリア
    setSearchingIndex(null);
    setSearchingStage(null);
    setSearchingMachine(null);
  };

  // 🔹 ステージ3の機種確認済みトグル
  const toggleMachineConfirmed = (idx) => {
    const updatedSet = new Set(confirmedMachines);
    if (updatedSet.has(idx)) {
      updatedSet.delete(idx);
    } else {
      updatedSet.add(idx);
    }
    setConfirmedMachines(updatedSet);
  };
  
  // 🔹 すべての機種が確定されたか判定
  const isAllConfirmed = () => {
    if (!pendingConfirmation) return false;
  
    const stage3Count = pendingConfirmation.machines.length;
    const stage4Count = pendingConfirmation.machinesStage4.length;
  
    const stage3Confirmed = stage3Count === 0 || confirmedMachines.size === stage3Count;
  
    const stage4AllFixed =
      stage4Count === 0 ||
      pendingConfirmation.machinesStage4.every(
        (m) => m.fixedName && m.fixedName.trim() !== ""
      );
  
    return stage3Confirmed && stage4AllFixed;
  };

  // 🔹 修正が必要な部分を特定してメッセージを表示
  const getUnconfirmedMessage = () => {
    let messages = [];

    if (!pendingConfirmation) return "データがありません。";

    // ステージ3の未確認データ
    const unconfirmedStage3 = pendingConfirmation.machines.filter(
      (_, idx) => !confirmedMachines.has(idx)
    );
    if (unconfirmedStage3.length > 0) {
      messages.push("確認が完了していません。");
    }

    // ステージ4の未修正データ
    const unconfirmedStage4 = pendingConfirmation.machinesStage4.filter(
      (m) => !m.fixedName || m.fixedName.trim() === ""
    );
    if (unconfirmedStage4.length > 0) {
      messages.push("機種名が未修正です。");
    }

    return messages.length > 0 ? messages.join("\n") : "すべての修正が完了しています。";
  };
  
  /** 🔹 確認後の更新処理 */
  const handleConfirmUpdate = async () => {
    if (!pendingConfirmation) {
      alert("確認するデータがありません");
      return;
    }
  
    console.log("🛠 `handleConfirmUpdate` に送るデータ:", pendingConfirmation);
  
    if (!pendingConfirmation.category) {
      alert("エラー: category が未定義です");
      console.error("❌ category が未定義:", pendingConfirmation);
      return;
    }
  
    try {
      const confirmResponse = await fetch(`${API_URL}/confirm-update-machine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isOwnStore: pendingConfirmation.isOwnStore, // ✅ 追加
          targetId: pendingConfirmation.isOwnStore 
            ? pendingConfirmation.storeId 
            : pendingConfirmation.competitorId, // ✅ 自店 or 競合
          category: pendingConfirmation.category,
          categoryId: pendingConfirmation.categoryId,
          totalQuantity: pendingConfirmation.totalQuantity,
          machines: pendingConfirmation.machines,  // ステージ3
          machinesStage4: pendingConfirmation.machinesStage4,  // ステージ4
          updatedAt: pendingConfirmation.updatedAt,
        }),
      });
  
      const confirmData = await confirmResponse.json();
  
      if (confirmResponse.ok) {
        alert("データが登録されました！");
        resetForm();
      } else {
        alert(`登録に失敗しました: ${confirmData.error}`);
      }
    } catch (error) {
      console.error("Error:", error);
      alert("エラーが発生しました");
    } finally {
      setShowConfirmationModal(false);
      setPendingConfirmation(null);
    }
  };  
  
  return (
    <div className="container">
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

        <label>種別:</label>
        {pachinkoTypes.length > 0 && (
          <div className="type-group">
            <span className="type-group-title">【パチンコ】</span>
            <div className="type-options">
              {pachinkoTypes.map((t) => (
                <label key={t} className="type-option">
                  <input
                    type="radio"
                    value={t}
                    checked={type === t}
                    onChange={(e) => setType(e.target.value)}
                  />
                  {t}
                </label>
              ))}
            </div>
          </div>
        )}
        {slotTypes.length > 0 && (
          <div className="type-group">
            <span className="type-group-title">【スロット】</span>
            <div className="type-options">
              {slotTypes.map((t) => (
                <label key={t} className="type-option">
                  <input
                    type="radio"
                    value={t}
                    checked={type === t}
                    onChange={(e) => setType(e.target.value)}
                  />
                  {t}
                </label>
              ))}
            </div>
          </div>
        )}

        <label>機種名 & 台数:</label>
        <textarea 
          className="machine-textarea" 
          value={machineData} 
          onChange={(e) => setMachineData(e.target.value)} 
          disabled={isLoading}
        />

        <button type="submit" className="submit-btn" disabled={isLoading}>
          {isLoading ? "処理中..." : "登録"}
        </button>
      </form>

      <Modal 
        isOpen={showConfirmationModal}
        onRequestClose={() => setShowConfirmationModal(false)}
        shouldCloseOnOverlayClick={false}
        shouldCloseOnEsc={false}
        contentLabel="機種データ確認"
        className="modal"
        overlayClassName="overlay"
      >
        <h2>機種データの確認</h2>

        {/* 🔹 ステージ3のデータ表示*/}
        {pendingConfirmation?.machines.length > 0 && (
          <>
            <h3>機種名が正しいか確認してください</h3>
            <table>
              <thead>
                <tr>
                  <th>確認</th>
                  <th>入力された機種名</th>
                  <th>マスター機種名</th>
                  <th>修正後の機種名</th>
                  <th>台数</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
              {pendingConfirmation.machines.map((m, idx) => {
                  const matchedMachine = pendingConfirmation?.machineDetails?.find(
                    (detail) => detail.sis_machine_code === m.sis_code
                  );
                  return (
                    <tr key={idx}>
                      <td>
                        <input 
                          type="checkbox" 
                          checked={confirmedMachines.has(idx)} 
                          onChange={() => toggleMachineConfirmed(idx)} 
                        />
                      </td>
                      <td>{m.inputName}</td> 
                      <td>{m.isFixed ? (
                          "修正済み"
                        ) : matchedMachine ? (
                          <a
                            href={`https://www.google.com/search?q=${encodeURIComponent(
                              matchedMachine.sis_machine_name
                            )}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "#007bff", textDecoration: "underline" }}
                          >
                            {matchedMachine.sis_machine_name}
                          </a>
                        ) : (
                          "不明"
                        )}
                      </td>
                      <td>{m.fixedName || "未修正"}</td>
                      <td>{m.quantity}</td>
                      <td>
                      <button onClick={() => handleEditMachine(3, idx, m)}>修正</button>
                    </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}

        {/* 🔹 ステージ4のデータ表示*/}
        {pendingConfirmation?.machinesStage4.length > 0 && (
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
                {pendingConfirmation.machinesStage4.map((m, idx) => (
                  <tr key={idx}>
                    <td>{m.inputName}</td>
                    <td>{m.fixedName || "未修正"}</td>
                    <td>{m.quantity}</td>
                    <td>
                      <button onClick={() => handleEditMachine(4, idx, m)}>修正</button>
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
            <h3>修正対象: {searchingMachine.inputName}</h3>

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

        {/* 🔹 確定ボタン（すべて確定しないと押せない） */}
        <button
          className="confirm-button"
          onClick={() => {
            if (!isAllConfirmed()) {
              alert(getUnconfirmedMessage());
            } else {
              handleConfirmUpdate();
            }
          }}
          disabled={!isAllConfirmed()}
        >
          確定する
        </button>

        <button onClick={resetModal}>キャンセル</button>
      </Modal>

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
