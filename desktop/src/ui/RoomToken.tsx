import { useState } from "react";
import { X } from "lucide-react";
import { Modal } from "./WorkflowShared";

export function RoomToken({
  name,
  onRename,
  onDelete,
}: {
  name: string;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <>
      <div className="room-token">
        <button
          className="room-token-label"
          aria-label={`${name} 이름 변경`}
          title="눌러서 이름 변경"
          onClick={() => setDraft(name)}
        >
          {name}
        </button>
        <button
          className="room-token-remove"
          aria-label={`${name} 삭제`}
          title="삭제"
          onClick={onDelete}
        >
          <span>
            <X size={10} strokeWidth={3} />
          </span>
        </button>
      </div>
      {draft !== null && (
        <Modal
          title="고사실 이름 변경"
          onClose={() => setDraft(null)}
          footer={
            <>
              <button onClick={() => setDraft(null)}>취소</button>
              <button
                className="primary"
                disabled={!draft.trim() || draft.trim().length > 100}
                onClick={() => {
                  onRename(draft.trim());
                  setDraft(null);
                }}
              >
                이름 변경
              </button>
            </>
          }
        >
          <label className="modal-field">
            고사실 이름
            <input
              autoFocus
              aria-label="고사실 새 이름"
              value={draft}
              maxLength={100}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
        </Modal>
      )}
    </>
  );
}
