import HealthBoard from '../components/HealthBoard.jsx';
import { PageHead } from './ui.jsx';
export default function BatchHealth() {
  return (<><PageHead title="Batch health" sub="Who is slipping in each batch: score drops, long absences, overdue assignments. Nudge them in one click." /><HealthBoard base="/admin" /></>);
}
