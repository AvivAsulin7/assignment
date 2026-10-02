import { useParams } from 'react-router';

export function FridgeDetail() {
  const { id } = useParams();
  return (
    <section>
      <h1>Fridge {id}</h1>
      <p>Temperature history — coming in Phase 9.</p>
    </section>
  );
}
