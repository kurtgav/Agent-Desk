import {
  Box, Boxes, ClipboardList, Code, Crown, DollarSign, Folder, FlaskConical, Gamepad2, GraduationCap, LifeBuoy, Map as MapIcon, Megaphone, PencilRuler,
  PenTool, Search, ShieldCheck, Sparkles, Stethoscope, Target, TrendingUp, UserRound, type LucideIcon
} from 'lucide-react'

/**
 * A division names its icon as a Lucide name (the clone's divisions.json). Importing the whole library by name would put every icon in
 * the bundle, so the ones the clone uses today and the ones AgentDeck adds are imported here, and any other name gets a folder.
 */
const TABLE: Record<string, LucideIcon> = {
  GraduationCap, PenTool, Code, DollarSign, Gamepad2, Map: MapIcon, Stethoscope, Megaphone, Target, Box, ClipboardList, Search, TrendingUp,
  ShieldCheck, Boxes, Sparkles, LifeBuoy, FlaskConical, Crown, PencilRuler, UserRound
}

export const roleIcon = (name: string): LucideIcon => TABLE[name] ?? Folder
