from shared.services.workspace_renderer import workspace_view


def register_routes(router):
    router.add('/templates', lambda params: workspace_view(params, 'templates'), name='templates', title='Templates', layout='blank', show_in_sidebar=False)
