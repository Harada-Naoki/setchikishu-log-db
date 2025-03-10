import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import "../css/MachineForm.css";

function SelectStore() {
  const [storeList, setStoreList] = useState([]);
  const [selected, setSelected] = useState("");
  const navigate = useNavigate();

  const API_URL = process.env.REACT_APP_API_URL;

  useEffect(() => {
    fetch(`${API_URL}/get-stores`)
      .then(res => res.json())
      .then(data => setStoreList(data))
      .catch(err => console.error("エラー:", err));
  }, [API_URL]);

  const handleNavigateRegister = () => {
    if (!selected) {
      alert("自店を選択してください");
      return;
    }
    const encodedStoreName = encodeURIComponent(selected);
    navigate(`/register/${encodedStoreName}`);
  };

  const handleNavigateMachines = () => {
    if (!selected) {
      alert("自店を選択してください");
      return;
    }
    const encodedStoreName = encodeURIComponent(selected);
    navigate(`/machines/${encodedStoreName}`);
  };

  const handleNavigateUpdates = () => {
    if (!selected) {
      alert("自店を選択してください");
      return;
    }
    const encodedStoreName = encodeURIComponent(selected);
    navigate(`/updates/${encodedStoreName}`);
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

      <div className="button-container">
        <div className="button-box" onClick={handleNavigateRegister}>
          <div className="icon">
            📝
          </div>
          <h3>機種登録画面へ</h3>
          <p>競合店舗の設置機種の登録を行う画面に移動します。</p>
        </div>

        <div className="button-box" onClick={handleNavigateMachines}>
          <div className="icon">
            📋
          </div>
          <h3>設置機種一覧へ</h3>
          <p>登録済みの設置機種一覧を確認・編集する画面に移動します。</p>
        </div>

        <div className="button-box" onClick={handleNavigateUpdates}>
          <div className="icon">
            🔄
          </div>
          <h3>更新情報一覧へ</h3>
          <p>競合店のカテゴリごとの最新更新状況を確認する画面に移動します。</p>
        </div>
      </div>

    </div>
  );
}

export default SelectStore;
