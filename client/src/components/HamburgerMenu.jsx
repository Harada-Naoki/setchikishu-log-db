import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../css/HamburgerMenu.css'; 

const HamburgerMenu = ({ storeName }) => {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <>
      <div className="hamburger-icon" onClick={() => setIsOpen(!isOpen)}>
        ☰
      </div>

      <div className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="close-btn" onClick={() => setIsOpen(false)}>×</div>

        <div className="menu-item" onClick={() => navigate(`/register/${encodeURIComponent(storeName)}`)}>
          <div className="icon">📝</div>
          <h3>機種登録画面へ</h3>
          <p>競合店舗の設置機種の登録を行う画面に移動します。</p>
        </div>

        <div className="menu-item" onClick={() => navigate(`/machines/${encodeURIComponent(storeName)}`)}>
          <div className="icon">📋</div>
          <h3>設置機種一覧へ</h3>
          <p>登録済みの設置機種一覧を確認・編集する画面に移動します。</p>
        </div>

        <div className="menu-item" onClick={() => navigate(`/updates/${encodeURIComponent(storeName)}`)}>
          <div className="icon">🔄</div>
          <h3>更新情報一覧へ</h3>
          <p>カテゴリごとの最新更新状況を確認する画面に移動します。</p>
        </div>

        <button className="navigate-btn" onClick={() => navigate(`/select-store`)}>
          Topへ
        </button>
      </div>
    </>
  );
};

export default HamburgerMenu;
