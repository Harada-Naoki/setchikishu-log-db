import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Modal from "react-modal";
import "../css/MachineForm.css";

Modal.setAppElement("#root");

function MachineForm({ selectedStore }) {
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

  const API_URL = process.env.REACT_APP_API_URL;

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
      .then(data => setTypeOptions(data))
      .catch(err => console.error("エラー:", err));
  }, [API_URL]);

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
      return;
    }
  
    const payload = {
      storeName: selectedStore,
      competitorName: selectedCompetitor,
      category: type,
      machines
    };
  
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
  
        const confirmedResponse = await fetch(`${API_URL}/confirm-machine-update`, {
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
      if (data.needsStage3Confirmation) {
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
          competitorId: pendingConfirmation.competitorId, 
          category: pendingConfirmation.category,
          categoryId: pendingConfirmation.categoryId, 
          totalQuantity: pendingConfirmation.totalQuantity, 
          machines: pendingConfirmation.machines,
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
  
  /** 🔹 フォームリセット関数 */
  const resetForm = () => {
    setSelectedCompetitor("");
    setType("");
    setMachineData("");
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
    } else {
      setSelectedCompetitor(value);
      setShowAddForm(false);
    }
  };

  /** 🔹 一覧画面へ遷移 */
  const handleNavigate = () => {
    if (!selectedCompetitor || !type) {
      alert("競合店舗と種別を選択してください！");
      return;
    }
    navigate(`/machines?store=${selectedStore}&competitor=${selectedCompetitor}&type=${type}`);
  };

  return (
    <div className="container">
      <h2>設置機種登録 - {selectedStore}</h2>
      {isLoading && <p className="loading-text">データ登録中...</p>}
      <form className="machine-form" onSubmit={handleSubmit}>
        <label>競合店を選択:</label>
        <select value={selectedCompetitor} onChange={handleCompetitorChange}>
          <option value="">選択してください</option>
          {competitors.map((store) => (
            <option key={store} value={store}>{store}</option>
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

        <label>種別:</label>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">選択してください</option>
          {typeOptions.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

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
        contentLabel="機種データ確認"
        className="modal"
        overlayClassName="overlay"
      >
        <h2>機種データの確認</h2>
        <p>以下のデータを登録してもよろしいですか？</p>

        <table>
          <thead>
            <tr>
              <th>登録予定の機種名</th>
              <th>マスター機種名</th>
              <th>台数</th>
            </tr>
          </thead>
          <tbody>
            {pendingConfirmation?.machines.map((m, idx) => {
              // `machineDetails` から `sis_machine_name` を取得
              const matchedMachine = pendingConfirmation?.machineDetails?.find(
                (detail) => detail.sis_machine_code === m.sis_code
              );

              return (
                <tr key={idx}>
                  <td>{m.inputName}</td> {/* 登録予定の機種名 */}
                  <td>{matchedMachine ? matchedMachine.sis_machine_name : "不明"}</td> {/* マスター機種名 */}
                  <td>{m.quantity}</td> {/* 台数 */}
                </tr>
              );
            })}
          </tbody>
        </table>

        <button onClick={handleConfirmUpdate}>確定する</button>
        <button onClick={() => setShowConfirmationModal(false)}>キャンセル</button>
      </Modal>
      <button onClick={handleNavigate} className="navigate-btn">機種一覧へ移動</button>
    </div>
  );
}

export default MachineForm;
