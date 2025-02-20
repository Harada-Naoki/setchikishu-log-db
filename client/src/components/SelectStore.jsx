import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

function SelectStore({ setSelectedStore }) {
  const [storeList, setStoreList] = useState([]);  // 🔹 データベースから取得する storeList
  const [selected, setSelected] = useState("");
  const navigate = useNavigate();

  const API_URL = process.env.REACT_APP_API_URL;

  // 🔹 API から `storeList` を取得
  useEffect(() => {
    fetch(`${API_URL}/get-stores`)
      .then(res => res.json())
      .then(data => setStoreList(data))
      .catch(err => console.error("エラー:", err));
  }, [API_URL]);

  const handleSelect = () => {
    if (!selected) {
      alert("自店を選択してください");
      return;
    }
    setSelectedStore(selected);
    navigate("/register");
  };

  return (
    <div className="container">
      <h2>自店を選択</h2>
      <select value={selected} onChange={(e) => setSelected(e.target.value)}>
        <option value="">選択してください</option>
        {storeList.map((store) => (
          <option key={store.name} value={store.name}>{store.name}</option>
        ))}
      </select>
      <button className="submit-btn" onClick={handleSelect}>次へ</button>
    </div>
  );
}

export default SelectStore;
