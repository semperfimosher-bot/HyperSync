import UploadQueueItem from "./UploadQueueItem.jsx";

export default function UploadQueue({
  queue,
  disabled,
  onUpdate,
  onRemove,
  onCancel,
  onRetry,
}) {
  if (queue.length === 0) {
    return (
      <section className="upload-queue upload-queue--empty">
        <strong>
          Your upload queue is empty
        </strong>

        <span>
          Drop some music above to get started.
        </span>
      </section>
    );
  }

  return (
    <section className="upload-queue">
      {queue.map((item) => (
        <UploadQueueItem
          key={item.id}
          item={item}
          disabled={disabled}
          onUpdate={onUpdate}
          onRemove={onRemove}
          onCancel={onCancel}
          onRetry={onRetry}
        />
      ))}
    </section>
  );
}
