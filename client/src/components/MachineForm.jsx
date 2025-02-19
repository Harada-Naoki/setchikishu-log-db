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

  // 🔹 API から `storeData` を取得し、競合店を取得
  useEffect(() => {
    fetch("http://localhost:5000/get-stores")
      .then(res => res.json())
      .then(data => {
        const store = data.find(s => s.name === selectedStore);
        const competitors = store ? store.competitors : [];
        setCompetitors(competitors);
      })
      .catch(err => console.error("エラー:", err));
  }, [selectedStore]);


  // 🔹 API から `typeOptions` を取得
  useEffect(() => {
    fetch("http://localhost:5000/get-types")
      .then(res => res.json())
      .then(data => setTypeOptions(data)) 
      .catch(err => console.error("エラー:", err));
  }, []);
  
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
      category: type,
      machines
    };

    try {
      const response = await fetch("http://localhost:5000/add-machine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        alert("データが登録されました！");
        setSelectedCompetitor("");
        setType("");
        setMachineData("");
      } else {
        alert("登録に失敗しました");
      }
    } catch (error) {
      console.error("Error:", error);
      alert("エラーが発生しました");
    }
  };

  // 🔹 競合店を追加する処理
  const handleAddCompetitor = async () => {
    if (!newCompetitor) {
      alert("競合店名を入力してください");
      return;
    }

    try {
      const response = await fetch("http://localhost:5000/add-competitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeName: selectedStore, competitorName: newCompetitor }),
      });

      if (response.ok) {
        alert("競合店が追加されました！");
        setCompetitors([...competitors, newCompetitor].sort((a, b) => a.localeCompare(b, "ja")));
        setNewCompetitor(""); // 入力フィールドをクリア
        setShowAddForm(false); // フォームを閉じる
        setSelectedCompetitor(newCompetitor); // 追加した競合店を選択
      } else {
        alert("競合店の追加に失敗しました");
      }
    } catch (error) {
      console.error("Error:", error);
      alert("エラーが発生しました");
    }
  };

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

  // 🔹 競合店舗・種別が選択されているか確認して遷移
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
        <textarea className="machine-textarea" value={machineData} onChange={(e) => setMachineData(e.target.value)} />

        <button type="submit" className="submit-btn">登録</button>
      </form>
      <button onClick={handleNavigate} className="navigate-btn">機種一覧へ移動</button>
    </div>
  );
}

export default MachineForm;
