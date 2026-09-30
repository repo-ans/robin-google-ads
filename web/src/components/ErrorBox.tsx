export default function ErrorBox({ message }: { message: string }) {
  return (
    <div className="mt-8 rounded-lg border border-danger-line bg-danger-soft p-4 text-danger">
      {message}
    </div>
  );
}
