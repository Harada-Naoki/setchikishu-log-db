import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import "../css/UpdateInfo.css";

function UpdateInfo() {
  const navigate = useNavigate();
  const { storeName } = useParams();
  const decodedStoreName = decodeURIComponent(storeName);
  const [updateInfo, setUpdateInfo] = useState([]);
  const API_URL = process.env.REACT_APP_API_URL;

  useEffect(() => {
    if (!API_URL || !decodedStoreName) return;

    fetch(`${API_URL}/get-all-latest-updates?storeName=${decodedStoreName}`)
      .then(res => res.json())
      .then(data => {
        console.log("✅ 更新情報取得:", data);
        setUpdateInfo(data);
      })
      .catch(err => console.error("❌ 更新情報取得エラー:", err));
  }, [API_URL, decodedStoreName]);

  const groupedData = updateInfo.reduce((acc, item) => {
    if (!acc[item.competitor_name]) acc[item.competitor_name] = [];
    acc[item.competitor_name].push(item);
    return acc;
  }, {});  

  return (
    <div className="update-info-container">
      <h2>{decodedStoreName} - 更新情報一覧</h2>

      {Object.keys(groupedData).length === 0 ? (
        <p>更新情報がありません。</p>
      ) : (
        Object.entries(groupedData).map(([competitorName, updates], index) => {
          const isOwnStore = competitorName === decodedStoreName;
        
          return (
            <div
              key={index}
              className={`competitor-block ${isOwnStore ? "own-store" : ""}`}
            >
              <h3>
                {isOwnStore ? "【自店】" : ""}{competitorName}
              </h3>
              <table className="update-info-table">
                <thead>
                  <tr>
                    <th>カテゴリ名</th>
                    <th>最新更新日時</th>
                  </tr>
                </thead>
                <tbody>
                  {updates.map((info, idx) => {
                    const isOldUpdate =
                      new Date() - new Date(info.latest_update) > 7 * 24 * 60 * 60 * 1000; // 1週間以上前
        
                    return (
                      <tr key={idx} className={isOldUpdate ? "old-update" : ""}>
                        <td>{info.category_name}</td>
                        <td>
                          {new Date(info.latest_update).toLocaleString("ja-JP", {
                            timeZone: "Asia/Tokyo",
                          })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })        
      )}

      <div className="button-container">
        <div className="button-box" onClick={() => navigate(`/register/${encodeURIComponent(storeName)}`)}>
          <div className="icon">
            📝
          </div>
          <h3>機種登録画面へ</h3>
          <p>競合店舗の設置機種の登録を行う画面に移動します。</p>
        </div>

        <div className="button-box" onClick={() => navigate(`/machines/${encodeURIComponent(storeName)}`)}>
          <div className="icon">
            📋
          </div>
          <h3>設置機種一覧へ</h3>
          <p>登録済みの設置機種一覧を確認・編集する画面に移動します。</p>
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

export default UpdateInfo;
