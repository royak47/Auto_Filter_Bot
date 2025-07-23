import logging
import logging.config
from pyrogram import Client
from pyrogram import types
from typing import Union, Optional, AsyncGenerator

from info import *
from utils import temp
from database.ia_filterdb import Media

# Logging config
logging.config.fileConfig('logging.conf')
logging.getLogger().setLevel(logging.INFO)
logging.getLogger("pyrogram").setLevel(logging.ERROR)
logging.getLogger("imdbpy").setLevel(logging.ERROR)
logging.getLogger("aiohttp").setLevel(logging.ERROR)
logging.getLogger("aiohttp.web").setLevel(logging.ERROR)

# ✅ Main Client Class
class dreamcinezoneXBot(Client):
    def __init__(self):
        super().__init__(
            name=SESSION,
            api_id=API_ID,
            api_hash=API_HASH,
            bot_token=BOT_TOKEN,
            workers=60,
            plugins={"root": "plugins"},
            sleep_threshold=5,
            protect_content=False  # ✅ Important fix for forwarding, copying, screenshots
        )

    async def iter_messages(
        self,
        chat_id: Union[int, str],
        limit: int,
        offset: int = 0,
    ) -> Optional[AsyncGenerator["types.Message", None]]:
        """
        Iterate through a chat sequentially.
        Returns a generator of Message objects.
        """
        current = offset
        while True:
            new_diff = min(200, limit - current)
            if new_diff <= 0:
                return
            messages = await self.get_messages(chat_id, list(range(current, current + new_diff + 1)))
            for message in messages:
                yield message
                current += 1

# ✅ Client Instance
dreamxbotz = dreamcinezoneXBot()

# ✅ Multi-client handling setup
multi_clients = {}
work_loads = {}
