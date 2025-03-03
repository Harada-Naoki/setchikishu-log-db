import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import { useState } from "react";
import Login from "./components/Login";
import SelectStore from "./components/SelectStore";
import MachineForm from "./components/MachineForm";
import MachineList from "./components/MachineList";
import SisSelect from "./components/SisSelectForm";

function App() {
  const [selectedStore, setSelectedStore] = useState("");

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/select-store" element={<SelectStore setSelectedStore={setSelectedStore} />} />
        <Route path="/register" element={<MachineForm selectedStore={selectedStore} />} />
        <Route path="/machines" element={<MachineList />} />
        <Route path="/sis-select" element={<SisSelect/>} />
      </Routes>
    </Router>
  );
}

export default App;
