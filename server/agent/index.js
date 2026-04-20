import Rag from "./rag.js";
import Workflow from "./workflow/index.js";
import { handleChatStream } from "./chat.js";

export const createAgents = async () => {
  const rag = await Rag();
  const workflow = Workflow({ rag });

  const handleChat = (req, res) => {
    return handleChatStream({ workflow, rag }, req, res);
  };

  return {
    handleChat,
    workflow,
    rag,
  };
};
