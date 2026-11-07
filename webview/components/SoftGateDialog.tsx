export function SoftGateDialog({
    title,
    items,
    consequence,
    onCancel,
    onProceed,
}: {
    title: string;
    items: string[];
    consequence: string;
    onCancel: () => void;
    onProceed: () => void;
}) {
    return (
        <div class="modal-layer">
            <dialog open class="soft-gate">
                <div class="dlg-head">{title}</div>
                <div class="dlg-body">
                    <div class="warn">
                        <b>缺少 {items.length} 项：</b>
                        <ul>
                            {items.map((item) => (
                                <li key={item}>{item}</li>
                            ))}
                        </ul>
                    </div>
                    <div class="hint">{consequence}</div>
                </div>
                <div class="dlg-foot">
                    <button class="btn" onClick={onCancel}>
                        取消
                    </button>
                    <button class="btn danger" onClick={onProceed}>
                        仍然推进
                    </button>
                </div>
            </dialog>
        </div>
    );
}
