import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import "../css/MachineForm.css";

function MachineForm({ selectedStore }) {
  const [competitors, setCompetitors] = useState([]);
  const [typeOptions, setTypeOptions] = useState([]);
  const [selectedCompetitor, setSelectedCompetitor] = useState("");
  const [type, setType] = useState("");
  const [machineData, setMachineData] = useState("");
  const [newCompetitor, setNewCompetitor] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const navigate = useNavigate();

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
    const machines = parseMachineData();
  
    if (!selectedCompetitor || !type || machines.length === 0) {
      alert("すべての項目を入力してください");
      return;
    }
  
    const payload = {
      storeName: selectedStore,
      competitorName: selectedCompetitor,
      category: type, // ✅ フロントエンドから category を送る
      machines
    };
  
    try {
      const response = await fetch(`${API_URL}/add-machine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
  
      const data = await response.json();
  
      if (response.ok) {
        if (data.needsConfirmation) {
          const userConfirmed = window.confirm(
            `${data.message}\nこのまま更新しますか？`
          );
  
          if (!userConfirmed) {
            alert("更新をキャンセルしました");
            return;
          }
  
          // `/confirm-update-machine` に category も送る
          const confirmResponse = await fetch(`${API_URL}/confirm-update-machine`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              competitorId: data.competitorId,
              category: data.category,  // ✅ ここで category を渡す
              categoryId: data.categoryId,
              totalQuantity: data.totalQuantity,
              machines: data.machines
            }),
          });
  
          const confirmData = await confirmResponse.json();
  
          if (confirmResponse.ok) {
            alert("データが登録されました！");
            setSelectedCompetitor("");
            setType("");
            setMachineData("");
          } else {
            alert(`登録に失敗しました: ${confirmData.error}`);
          }
        } else {
          alert("データが登録されました！");
          setSelectedCompetitor("");
          setType("");
          setMachineData("");
        }
      } else {
        alert(`登録に失敗しました: ${data.error}`);
      }
    } catch (error) {
      console.error("Error:", error);
      alert("エラーが発生しました");
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
        />

        <button type="submit" className="submit-btn">登録</button>
      </form>
      <button onClick={handleNavigate} className="navigate-btn">機種一覧へ移動</button>
    </div>
  );
}

export default MachineForm;
